const { SettingsManager } = require('../../src/settingsManager');

describe('SettingsManager', () => {
  let settingsMock;
  let extensionMock;
  let settingsManager;

  beforeEach(() => {
    settingsMock = {
      get_string: jest.fn(),
      set_string: jest.fn(),
      get_boolean: jest.fn(),
      set_boolean: jest.fn(),
    };
    extensionMock = {
      getSettings: jest.fn(() => settingsMock),
    };
    settingsManager = new SettingsManager(extensionMock);
  });

  it('should read the monitored directory', () => {
    settingsMock.get_string.mockReturnValue('/my/monitored/path');
    expect(settingsManager.getMonitoredDirectory()).toBe('/my/monitored/path');
    expect(settingsMock.get_string).toHaveBeenCalledWith('monitored-directory');
  });

  it('should fallback to default monitored directory if not stored', () => {
    settingsMock.get_string.mockReturnValue('');
    expect(settingsManager.getMonitoredDirectory()).toBe('/home/user/Applications');
  });

  it('should write the monitored directory', () => {
    settingsManager.setMonitoredDirectory('/new/path');
    expect(settingsMock.set_string).toHaveBeenCalledWith('monitored-directory', '/new/path');
  });

  it('should read deep-icon-search setting', () => {
    settingsMock.get_boolean.mockReturnValue(true);
    expect(settingsManager.getDeepIconSearch()).toBe(true);
    expect(settingsMock.get_boolean).toHaveBeenCalledWith('deep-icon-search');
  });

  it('should write deep-icon-search setting', () => {
    settingsManager.setDeepIconSearch(true);
    expect(settingsMock.set_boolean).toHaveBeenCalledWith('deep-icon-search', true);
  });
});
