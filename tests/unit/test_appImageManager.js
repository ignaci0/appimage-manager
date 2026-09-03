const { AppImageManager } = require('../../src/appImageManager');
const Gio = require('gi://Gio');

describe('AppImageManager', () => {
  let appImageManager;
  let settingsManagerMock;

  const createMockFile = (name, isDir = false, children = []) => {
    let mock = {
      get_name: jest.fn(() => name),
      get_path: jest.fn(() => name === 'squashfs-root' ? '/tmp/squashfs-root' : `/tmp/squashfs-root/${name}`),
      get_file_type: jest.fn(() => isDir ? 2 : 1), // 2 = Gio.FileType.DIRECTORY, 1 = Gio.FileType.REGULAR
      query_exists: jest.fn(() => true),
      get_child: jest.fn((childName) => {
        let match = children.find(c => c.get_name() === childName);
        if (match) return match;
        return {
          get_name: jest.fn(() => childName),
          get_path: jest.fn(() => `/tmp/squashfs-root/${childName}`),
          query_exists: jest.fn(() => false),
          get_child: jest.fn(() => null),
        };
      }),
      enumerate_children: jest.fn(() => {
        let idx = 0;
        return {
          next_file: jest.fn(() => {
            if (idx < children.length) {
              let c = children[idx++];
              return {
                get_name: jest.fn(() => c.get_name()),
                get_file_type: jest.fn(() => c.get_file_type()),
              };
            }
            return null;
          }),
          close: jest.fn(),
        };
      }),
    };
    return mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    settingsManagerMock = {
      getDeepIconSearch: jest.fn(() => false),
    };
    appImageManager = new AppImageManager(null, settingsManagerMock);
  });

  it('should identify an AppImage file', () => {
    expect(appImageManager.isAppImage('test.AppImage')).toBe(true);
  });

  it('should not identify a non-AppImage file', () => {
    expect(appImageManager.isAppImage('test.txt')).toBe(false);
  });

  describe('Icon search logic', () => {
    it('should find exact icon file at squashfs root if it exists', () => {
      const iconFile = createMockFile('my-app-icon.png', false);
      const squashfsRoot = createMockFile('squashfs-root', true, [iconFile]);

      const result = appImageManager._findIcon(squashfsRoot, 'my-app-icon.png');
      expect(result).toBe('/tmp/squashfs-root/my-app-icon.png');
    });

    it('should find .DirIcon at squashfs root if it exists', () => {
      const dirIcon = createMockFile('.DirIcon', false);
      const squashfsRoot = createMockFile('squashfs-root', true, [dirIcon]);

      const result = appImageManager._findIcon(squashfsRoot, 'my-app-icon.png');
      expect(result).toBe('/tmp/squashfs-root/.DirIcon');
    });

    it('should find icon in usr/share/pixmaps', () => {
      const iconFile = createMockFile('my-app-icon.png', false);
      const pixmaps = createMockFile('pixmaps', true, [iconFile]);
      const share = createMockFile('share', true, [pixmaps]);
      const usr = createMockFile('usr', true, [share]);
      const squashfsRoot = createMockFile('squashfs-root', true, [usr]);

      const result = appImageManager._findIcon(squashfsRoot, 'my-app-icon.png');
      expect(result).toBe('/tmp/squashfs-root/my-app-icon.png');
    });

    it('should perform deep search if enabled and exact match is deep in package', () => {
      settingsManagerMock.getDeepIconSearch.mockReturnValue(true);

      const iconFile = createMockFile('my-app-icon.png', false);
      const nestedDir = createMockFile('nested', true, [iconFile]);
      const squashfsRoot = createMockFile('squashfs-root', true, [nestedDir]);

      const result = appImageManager._findIcon(squashfsRoot, 'my-app-icon');
      expect(result).toBe('/tmp/squashfs-root/my-app-icon.png');
    });

    it('should perform deep search for partial match if enabled and exact match not found', () => {
      settingsManagerMock.getDeepIconSearch.mockReturnValue(true);

      const partialIconFile = createMockFile('logo-my-app-icon-alt.png', false);
      const nestedDir = createMockFile('nested', true, [partialIconFile]);
      const squashfsRoot = createMockFile('squashfs-root', true, [nestedDir]);

      const result = appImageManager._findIcon(squashfsRoot, 'my-app-icon');
      expect(result).toBe('/tmp/squashfs-root/logo-my-app-icon-alt.png');
    });

    it('should NOT perform deep search if disabled', () => {
      settingsManagerMock.getDeepIconSearch.mockReturnValue(false);

      const iconFile = createMockFile('my-app-icon.png', false);
      const nestedDir = createMockFile('nested', true, [iconFile]);
      const squashfsRoot = createMockFile('squashfs-root', true, [nestedDir]);

      const result = appImageManager._findIcon(squashfsRoot, 'my-app-icon');
      expect(result).toBe('/tmp/squashfs-root/my-app-icon.png');
      expect(settingsManagerMock.getDeepIconSearch).toHaveBeenCalled();
    });
  });

  describe('removeAppImage', () => {
    it('should delete launcher using cached name if present in cache', async () => {
      const deleteLauncherMock = jest.spyOn(appImageManager._launcherService, 'deleteLauncher');
      
      // Seed cache
      await appImageManager._cacheManager.add({
        path: '/path/to/AnythingLLMDesktop.AppImage',
        name: 'AnythingLLM'
      });

      await appImageManager.removeAppImage('/path/to/AnythingLLMDesktop.AppImage');

      expect(deleteLauncherMock).toHaveBeenCalledWith('AnythingLLM');
      expect(deleteLauncherMock).not.toHaveBeenCalledWith('AnythingLLMDesktop');
      
      // Should be removed from cache
      const cached = await appImageManager._cacheManager.get('/path/to/AnythingLLMDesktop.AppImage');
      expect(cached).toBeUndefined();
    });

    it('should fallback to filename parsing if not present in cache', async () => {
      const deleteLauncherMock = jest.spyOn(appImageManager._launcherService, 'deleteLauncher');
      
      // Ensure it is not in cache
      await appImageManager._cacheManager.remove('/path/to/AnyCoolApp.AppImage');

      await appImageManager.removeAppImage('/path/to/AnyCoolApp.AppImage');

      expect(deleteLauncherMock).toHaveBeenCalledWith('AnyCoolApp');
    });

    it('should delete cached icon file if present', async () => {
      const Gio = require('gi://Gio');
      const originalImpl = Gio.File.new_for_path.getMockImplementation();
      const mockIconFile = {
        query_exists: jest.fn(() => true),
        delete: jest.fn(),
      };
      Gio.File.new_for_path.mockImplementation(path => {
        if (path === '/path/to/icon.png') return mockIconFile;
        return originalImpl ? originalImpl(path) : mockFile;
      });

      await appImageManager._cacheManager.add({
        path: '/path/to/AppWithIcon.AppImage',
        name: 'AppWithIcon',
        icon: '/path/to/icon.png'
      });

      await appImageManager.removeAppImage('/path/to/AppWithIcon.AppImage');

      expect(mockIconFile.delete).toHaveBeenCalled();
      if (originalImpl) {
        Gio.File.new_for_path.mockImplementation(originalImpl);
      }
    });
  });

  describe('addAppImage', () => {
    it('should skip if cached, launcher exists, and has valid icon', async () => {
      const createLauncherMock = jest.spyOn(appImageManager._launcherService, 'createLauncher').mockImplementation(() => {});
      const launcherExistsMock = jest.spyOn(appImageManager._launcherService, 'launcherExists').mockReturnValue(true);
      const hasValidIconMock = jest.spyOn(appImageManager._launcherService, 'hasValidIcon').mockReturnValue(true);
      jest.spyOn(appImageManager._launcherService, 'isLauncherUpToDate').mockReturnValue(true);
      const extractMetadataMock = jest.spyOn(appImageManager, 'extractMetadata');
      jest.spyOn(appImageManager, '_resolveIconPath').mockReturnValue('/path/to/icon.png');

      await appImageManager._cacheManager.add({
        path: '/path/to/AnythingLLMDesktop.AppImage',
        name: 'AnythingLLM',
        icon: '/path/to/icon.png'
      });

      await appImageManager.addAppImage('/path/to/AnythingLLMDesktop.AppImage');

      expect(launcherExistsMock).toHaveBeenCalledWith('AnythingLLM');
      expect(hasValidIconMock).toHaveBeenCalledWith('AnythingLLM');
      expect(createLauncherMock).not.toHaveBeenCalled();
      expect(extractMetadataMock).not.toHaveBeenCalled();
    });

    it('should recreate launcher with valid icon if launcher exists but has fallback icon', async () => {
      const createLauncherMock = jest.spyOn(appImageManager._launcherService, 'createLauncher').mockImplementation(() => {});
      const launcherExistsMock = jest.spyOn(appImageManager._launcherService, 'launcherExists').mockReturnValue(true);
      const hasValidIconMock = jest.spyOn(appImageManager._launcherService, 'hasValidIcon').mockReturnValue(false);
      const extractMetadataMock = jest.spyOn(appImageManager, 'extractMetadata');
      jest.spyOn(appImageManager, '_resolveIconPath').mockReturnValue('/path/to/icon.png');

      await appImageManager._cacheManager.add({
        path: '/path/to/AnythingLLMDesktop.AppImage',
        name: 'AnythingLLM'
      });

      await appImageManager.addAppImage('/path/to/AnythingLLMDesktop.AppImage');

      expect(launcherExistsMock).toHaveBeenCalledWith('AnythingLLM');
      expect(hasValidIconMock).toHaveBeenCalledWith('AnythingLLM');
      expect(createLauncherMock).toHaveBeenCalledWith(expect.objectContaining({
        name: 'AnythingLLM',
        icon: '/path/to/icon.png'
      }));
      expect(extractMetadataMock).not.toHaveBeenCalled();
    });

    it('should recreate launcher if cached but launcher is missing', async () => {
      const createLauncherMock = jest.spyOn(appImageManager._launcherService, 'createLauncher').mockImplementation(() => {});
      const launcherExistsMock = jest.spyOn(appImageManager._launcherService, 'launcherExists').mockReturnValue(false);
      const extractMetadataMock = jest.spyOn(appImageManager, 'extractMetadata');
      jest.spyOn(appImageManager, '_resolveIconPath').mockReturnValue('/path/to/icon.png');

      const cachedMetadata = {
        path: '/path/to/AnythingLLMDesktop.AppImage',
        name: 'AnythingLLM',
        icon: '/path/to/icon.png',
        categories: ['Utility']
      };
      await appImageManager._cacheManager.add(cachedMetadata);

      await appImageManager.addAppImage('/path/to/AnythingLLMDesktop.AppImage');

      expect(launcherExistsMock).toHaveBeenCalledWith('AnythingLLM');
      expect(createLauncherMock).toHaveBeenCalledWith(expect.objectContaining(cachedMetadata));
      expect(extractMetadataMock).not.toHaveBeenCalled();
    });

    it('should extract metadata and create launcher if not cached', async () => {
      const createLauncherMock = jest.spyOn(appImageManager._launcherService, 'createLauncher').mockImplementation(() => {});
      const mockMetadata = {
        name: 'NewApp',
        path: '/path/to/NewApp.AppImage',
        icon: '/path/to/icon.png',
        categories: ['Utility'],
        desktopFilePath: null,
        desktopContent: null
      };
      const extractMetadataMock = jest.spyOn(appImageManager, 'extractMetadata').mockResolvedValue(mockMetadata);
      jest.spyOn(appImageManager, '_resolveIconPath').mockReturnValue(null);
      
      // Ensure it is not in cache
      await appImageManager._cacheManager.remove('/path/to/NewApp.AppImage');

      await appImageManager.addAppImage('/path/to/NewApp.AppImage');

      expect(extractMetadataMock).toHaveBeenCalledWith('/path/to/NewApp.AppImage');
      expect(createLauncherMock).toHaveBeenCalledWith(mockMetadata);
      
      const cached = await appImageManager._cacheManager.get('/path/to/NewApp.AppImage');
      expect(cached).toEqual(mockMetadata);
    });
  });
});