'use strict';

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

import { log, logError } from './logger.js';

export var CacheManager = GObject.registerClass({
    GTypeName: 'CacheManager'
}, class CacheManager extends GObject.Object {
    _init(params) {
        super._init(params);
        this._cacheFile = Gio.File.new_for_path(
            GLib.get_user_cache_dir() + '/appimage-manager/cache.json'
        );
        this._cache = {};
        this._savePromise = Promise.resolve();
        this._cacheLoaded = this._loadCache();
    }

    _loadCache() {
        return new Promise((resolve) => {
            if (!this._cacheFile.query_exists(null)) {
                log('Cache file does not exist. Creating it.');
                this._cacheFile.get_parent().make_directory_with_parents(null);
                this._cacheFile.create(Gio.FileCreateFlags.NONE, null);
                this._saveCache().then(() => resolve());
            } else {
                this._cacheFile.load_contents_async(null, (file, res) => {
                    try {
                        let [ok, contents] = file.load_contents_finish(res);
                        if (ok && contents) {
                            const decoder = new TextDecoder('utf-8');
                            const contentsStr = decoder.decode(contents);
                            if (contentsStr) {
                                this._cache = JSON.parse(contentsStr);
                            }
                        }
                    } catch (e) {
                        logError('Failed to load cache: ' + e);
                    } finally {
                        resolve();
                    }
                });
            }
        });
    }

    _saveCache() {
        this._savePromise = this._savePromise.then(() => {
            return new Promise(resolve => {
                try {
                    let contents = JSON.stringify(this._cache, null, 2);
                    let encoder = new TextEncoder();
                    let bytes = new GLib.Bytes(encoder.encode(contents));
                    this._cacheFile.replace_contents_bytes_async(
                        bytes,
                        null,
                        false,
                        Gio.FileCreateFlags.REPLACE_DESTINATION,
                        null,
                        (file, res) => {
                            try {
                                file.replace_contents_finish(res);
                            } catch (e) {
                                logError('Failed to save cache: ' + e);
                            } finally {
                                resolve();
                            }
                        }
                    );
                } catch (e) {
                    logError('Failed to save cache: ' + e);
                    resolve();
                }
            });
        });
        return this._savePromise;
    }

    async add(appImage) {
        await this._cacheLoaded;
        this._cache[appImage.path] = appImage;
        await this._saveCache();
    }

    async remove(appImagePath) {
        await this._cacheLoaded;
        delete this._cache[appImagePath];
        await this._saveCache();
    }

    async get(appImagePath) {
        await this._cacheLoaded;
        return this._cache[appImagePath];
    }

    async getAll() {
        await this._cacheLoaded;
        return this._cache;
    }
});