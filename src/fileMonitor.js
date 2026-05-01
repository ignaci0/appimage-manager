import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { log, logError } from './logger.js';

export class FileMonitor {
    constructor() {
        this._monitor = null;
        this._directory = null;
        this._onFileAdded = null;
        this._onFileRemoved = null;
        this._timeoutId = null;
        this._addedFiles = [];
    }

    startMonitoring(directoryPath, onFileAdded, onFileRemoved) {
        this._directory = Gio.File.new_for_path(directoryPath);
        if (!this._directory.query_exists(null)) {
            // Create the directory if it doesn't exist
            try {
                this._directory.make_directory_with_parents(null);
                log(`Created monitored directory: ${directoryPath}`);
            } catch (e) {
                logError(`Failed to create monitored directory ${directoryPath}: ${e.message}`);
                return false;
            }
        }

        this._onFileAdded = onFileAdded;
        this._onFileRemoved = onFileRemoved;

        try {
            this._monitor = this._directory.monitor_directory(Gio.FileMonitorFlags.NONE, null);
        } catch (e) {
            logError(`Failed to monitor directory ${directoryPath}: ${e.message}`);
            return false;
        }
        this._monitor.connect('changed', (monitor, file, otherFile, eventType) => {
            log(`File monitor event: ${eventType}`);
            switch (eventType) {
                case Gio.FileMonitorEvent.CHANGES_DONE_HINT:
                    // This event is often fired after a file is added/removed/changed.
                    // We need to re-scan the directory or rely on other events.
                    // For simplicity, we'll rely on the ADDED/DELETED events for now.
                    break;
                case Gio.FileMonitorEvent.CREATED:
                    {
                        const filePath = file.get_path();
                        if (!this._addedFiles.includes(filePath)) {
                            this._addedFiles.push(filePath);
                        }

                        if (this._timeoutId) {
                            GLib.source_remove(this._timeoutId);
                        }

                        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                            this._timeoutId = null; // It's a one-shot timeout
                            const filesToAdd = [...this._addedFiles];
                            this._addedFiles = []; // Clear the array

                            for (const addedFilePath of filesToAdd) {
                                if (addedFilePath.endsWith('.desktop')) {
                                    const desktopFile = Gio.File.new_for_path(addedFilePath);
                                    desktopFile.load_contents_async(null, (f, res) => {
                                        let isFromManager = false;
                                        try {
                                            const [success, contents] = f.load_contents_finish(res);
                                            if (success) {
                                                const contentsStr = new TextDecoder('utf-8').decode(contents);
                                                if (contentsStr.includes('# Created by AppImage Manager')) {
                                                    isFromManager = true;
                                                }
                                            }
                                        } catch (e) {
                                            logError(`Could not read ${addedFilePath}: ${e.message}`);
                                        }

                                        if (!isFromManager && this._onFileAdded) {
                                            this._onFileAdded(addedFilePath);
                                        }
                                    });
                                } else {
                                    if (this._onFileAdded) {
                                        this._onFileAdded(addedFilePath);
                                    }
                                }
                            }

                            return GLib.SOURCE_REMOVE;
                        });
                    }
                    break;
                case Gio.FileMonitorEvent.DELETED:
                    if (this._onFileRemoved) {
                        this._onFileRemoved(file.get_path());
                    }
                    break;
                default:
                    log(`Unhandled file monitor event: ${eventType}`);
            }
        });
        log(`Started monitoring directory: ${directoryPath}`);
        return true;
    }

    stopMonitoring() {
        if (this._monitor) {
            this._monitor.cancel();
            this._monitor = null;
            log(`Stopped monitoring directory: ${this._directory.get_path()}`);
        }
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
    }

    pause() {
        if (this._monitor) {
            this._monitor.cancel();
            this._monitor = null;
            log('Paused file monitoring');
        }
    }

    resume() {
        if (!this._monitor && this._directory) {
            this.startMonitoring(this._directory.get_path(), this._onFileAdded, this._onFileRemoved);
            log('Resumed file monitoring');
        }
    }
}
