const mockFile = {
  query_exists: jest.fn(() => false),
  make_directory_with_parents: jest.fn(() => { throw new Error('Mock error'); }),
  get_parent: jest.fn(() => mockFile),
  create: jest.fn(() => ({})),
  monitor_directory: jest.fn(() => ({
    connect: jest.fn(),
    cancel: jest.fn(),
  })),
  replace_contents: jest.fn(() => { throw new Error('Mock error'); }),
  delete: jest.fn(() => { throw new Error('Mock error'); }),
  query_info: jest.fn(() => ({
    get_permissions: jest.fn(() => ({})),
  })),
  set_attribute_uint32: jest.fn(),
  get_path: jest.fn(path => `/home/user/.local/share/applications`),
  load_contents: jest.fn(() => [false, null]),
  replace_contents_bytes_async: jest.fn((bytes, etag, make_backup, flags, cancellable, callback) => {
    if (callback) callback(mockFile, {});
  }),
  replace_contents_finish: jest.fn(() => [true, null]),
};

global.imports = {
  gi: {
    Gio: {
      File: {
        new_for_path: jest.fn(path => mockFile),
      },
      FileMonitorFlags: {
        NONE: 0,
      },
      FileMonitorEvent: {
        CHANGES_DONE_HINT: 0,
        FILE_CREATED: 1,
        FILE_DELETED: 2,
      },
      FilePermission: {
        EXECUTE: 1,
      },
      FileQueryInfoFlags: {
        NONE: 0,
      },
      FileCreateFlags: {
        REPLACE_DESTINATION: 1,
      },
      FileType: {
        REGULAR: 1,
        DIRECTORY: 2,
      },
    },
    GLib: {
      get_home_dir: jest.fn(() => '/home/user'),
      get_user_data_dir: jest.fn(() => '/home/user/.local/share'),
      get_user_cache_dir: jest.fn(() => '/home/user/.cache'),
      build_pathv: jest.fn((sep, paths) => paths.join(sep)),
      path_get_basename: jest.fn(path => path.split('/').pop()),
      Bytes: jest.fn().mockImplementation(array => ({ array })),
    },
  },
};

global.log = jest.fn();
global.logError = jest.fn();
