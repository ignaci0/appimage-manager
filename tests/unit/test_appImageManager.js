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
  });
});