class Bytes {
  constructor(array) {
    this.array = array;
  }
}

module.exports = {
  build_pathv: jest.fn((sep, parts) => parts.join(sep)),
  get_user_data_dir: jest.fn(() => '/home/user/.local/share'),
  get_home_dir: jest.fn(() => '/home/user'),
  get_user_cache_dir: jest.fn(() => '/home/user/.cache'),
  get_tmp_dir: jest.fn(() => '/tmp'),
  uuid_string_random: jest.fn(() => 'mock-uuid'),
  path_get_basename: jest.fn((path) => path.split('/').pop()),
  PRIORITY_DEFAULT: 0,
  child_watch_add: jest.fn((priority, pid, callback) => callback(pid, 0)),
  spawn_close_pid: jest.fn(),
  spawn_async: jest.fn(() => [true, 123]),
  SpawnFlags: {
    DO_NOT_REAP_CHILD: 1,
  },
  Bytes,
};

