const mockFile = (path) => ({
  query_exists: jest.fn(() => false),
  make_directory_with_parents: jest.fn(),
  replace_contents: jest.fn(),
  replace_contents_async: jest.fn(function (contents, etag, make_backup, flags, cancellable, callback) {
    if (callback) callback(this, {});
  }),
  replace_contents_finish: jest.fn(() => [true, null]),
  delete: jest.fn(),
  monitor_directory: jest.fn(() => ({ connect: jest.fn(), cancel: jest.fn() })),
  load_contents: jest.fn(() => [true, '# Created by AppImage Manager']),
  get_path: jest.fn(() => path),
  get_child: jest.fn((name) => mockFile(`${path}/${name}`)),
  enumerate_children: jest.fn(() => ({
    next_file: jest.fn(() => null),
    close: jest.fn(),
  })),
  copy: jest.fn(),
  set_attribute_uint32: jest.fn(),
  query_info: jest.fn(() => ({ get_attribute_uint32: jest.fn(() => 0) })),
});

module.exports = {
  File: {
    new_for_path: jest.fn((path) => mockFile(path)),
  },
  FileMonitorEvent: {
    CREATED: 0,
    DELETED: 1,
    CHANGES_DONE_HINT: 2,
  },
  FileCreateFlags: {
    REPLACE_DESTINATION: 0,
  },
  FileCopyFlags: {
    OVERWRITE: 0,
  },
  FileQueryInfoFlags: {
    NONE: 0,
  },
  FileMonitorFlags: {
    NONE: 0,
  },
};
