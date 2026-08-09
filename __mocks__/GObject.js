'use strict';

const GObject = {
    Object: class {
        constructor(...args) {
            this._init(...args);
        }
        _init() {}
    },
    registerClass: jest.fn((options, cls) => cls),
};

export default GObject;
