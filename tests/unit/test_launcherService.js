const { LauncherService } = require('../../src/launcherService');

describe('LauncherService', () => {
  let launcherService;

  beforeEach(() => {
    jest.clearAllMocks();
    launcherService = new LauncherService();
  });

  it('should create a launcher', () => {
    const metadata = {
      name: 'My Cool App',
      path: '/path/to/my-cool-app.AppImage',
      icon: 'application-x-appimage',
      categories: ['Utility'],
    };

    const desktopFilePath = launcherService.createLauncher(metadata);
    expect(desktopFilePath).toBe('/home/user/.local/share/applications/My Cool App.desktop');
  });

  it('should remove a launcher', () => {
    const Gio = require('gi://Gio');
    const mockFile = {
      query_exists: jest.fn(() => true),
      delete: jest.fn(),
      get_path: jest.fn(() => '/home/user/.local/share/applications'),
      replace_contents_bytes_async: jest.fn(),
    };
    Gio.File.new_for_path.mockReturnValue(mockFile);

    const result = launcherService.deleteLauncher('My Cool App');
    expect(result).toBe(true);
    expect(mockFile.delete).toHaveBeenCalled();
  });

  it('should patch shipped desktop file correctly', () => {
    const Gio = require('gi://Gio');
    const mockFile = Gio.File.new_for_path();
    mockFile.replace_contents_bytes_async.mockClear();

    const originalDesktopContent = `[Desktop Entry]
Name=Original Name
Comment=Original Comment
Exec=AppRun --no-sandbox %U
Icon=anythingllm-desktop
Categories=Network;InstantMessaging;
StartupWMClass=AnythingLLM
MimeType=x-scheme-handler/anythingllm;
`;

    const metadata = {
      name: 'AnythingLLM',
      path: '/home/user/Applications/AnythingLLM.AppImage',
      icon: '/home/user/.local/share/icons/hicolor/256x256/apps/AnythingLLM.png',
      desktopContent: originalDesktopContent,
    };

    launcherService.createLauncher(metadata);

    expect(mockFile.replace_contents_bytes_async).toHaveBeenCalled();
    const passedBytes = mockFile.replace_contents_bytes_async.mock.calls[0][0];
    
    const decoder = new TextDecoder('utf-8');
    const writtenContent = decoder.decode(passedBytes.array);

    expect(writtenContent).toContain('Name=Original Name');
    expect(writtenContent).toContain('Comment=Original Comment');
    expect(writtenContent).toContain('Exec="/home/user/Applications/AnythingLLM.AppImage" --no-sandbox %U');
    expect(writtenContent).toContain('Icon=/home/user/.local/share/icons/hicolor/256x256/apps/AnythingLLM.png');
    expect(writtenContent).toContain('Categories=Network;InstantMessaging;');
    expect(writtenContent).toContain('StartupWMClass=AnythingLLM');
    expect(writtenContent).toContain('MimeType=x-scheme-handler/anythingllm;');
  });

  it('should patch TryExec to point to appPath if present', () => {
    const Gio = require('gi://Gio');
    const mockFile = Gio.File.new_for_path();
    mockFile.replace_contents_bytes_async.mockClear();

    const originalDesktopContent = `[Desktop Entry]
Name=Eden
TryExec=eden
Exec=eden %f
Icon=dev.eden_emu.eden
`;

    const metadata = {
      name: 'Eden',
      path: '/home/user/Applications/Eden.AppImage',
      icon: '/home/user/.local/share/icons/hicolor/scalable/apps/Eden.svg',
      desktopContent: originalDesktopContent,
    };

    launcherService.createLauncher(metadata);

    expect(mockFile.replace_contents_bytes_async).toHaveBeenCalled();
    const passedBytes = mockFile.replace_contents_bytes_async.mock.calls[0][0];
    const decoder = new TextDecoder('utf-8');
    const writtenContent = decoder.decode(passedBytes.array);

    expect(writtenContent).toContain('TryExec=/home/user/Applications/Eden.AppImage');
    expect(writtenContent).toContain('Exec="/home/user/Applications/Eden.AppImage" %f');
  });

  describe('launcherExists', () => {
    it('should return true if desktop file exists', () => {
      const Gio = require('gi://Gio');
      const mockFile = {
        query_exists: jest.fn(() => true),
        get_path: jest.fn(() => '/home/user/.local/share/applications'),
      };
      Gio.File.new_for_path.mockReturnValue(mockFile);

      const exists = launcherService.launcherExists('My Cool App');
      expect(exists).toBe(true);
    });

    it('should return false if desktop file does not exist', () => {
      const Gio = require('gi://Gio');
      const mockFile = {
        query_exists: jest.fn(() => false),
        get_path: jest.fn(() => '/home/user/.local/share/applications'),
        make_directory_with_parents: jest.fn(),
      };
      Gio.File.new_for_path.mockReturnValue(mockFile);

      const exists = launcherService.launcherExists('My Cool App');
      expect(exists).toBe(false);
    });
  });

  describe('hasValidIcon', () => {
    it('should return false if desktop file does not exist', () => {
      const Gio = require('gi://Gio');
      const mockFile = {
        query_exists: jest.fn(() => false),
        get_path: jest.fn(() => '/home/user/.local/share/applications'),
        make_directory_with_parents: jest.fn(),
      };
      Gio.File.new_for_path.mockReturnValue(mockFile);

      expect(launcherService.hasValidIcon('My Cool App')).toBe(false);
    });

    it('should return false if desktop file has fallback icon application-x-appimage', () => {
      const Gio = require('gi://Gio');
      const encoder = new TextEncoder();
      const mockFile = {
        query_exists: jest.fn(() => true),
        get_path: jest.fn(() => '/home/user/.local/share/applications'),
        load_contents: jest.fn(() => [true, encoder.encode('[Desktop Entry]\nIcon=application-x-appimage')]),
      };
      Gio.File.new_for_path.mockReturnValue(mockFile);

      expect(launcherService.hasValidIcon('My Cool App')).toBe(false);
    });

    it('should return true if desktop file has valid icon path', () => {
      const Gio = require('gi://Gio');
      const encoder = new TextEncoder();
      const mockFile = {
        query_exists: jest.fn(() => true),
        get_path: jest.fn(() => '/home/user/.local/share/applications'),
        load_contents: jest.fn(() => [true, encoder.encode('[Desktop Entry]\nIcon=/home/user/.local/share/icons/hicolor/256x256/apps/My Cool App.png')]),
      };
      Gio.File.new_for_path.mockReturnValue(mockFile);

      expect(launcherService.hasValidIcon('My Cool App')).toBe(true);
    });
  });
});