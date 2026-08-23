import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { LauncherService } from './launcherService.js';
import { log, logError } from './logger.js';
import { CacheManager } from './cacheManager.js';

export class AppImageManager {
    constructor(fileMonitor = null, settingsManager = null) {
        this._launcherService = new LauncherService();
        this._fileMonitor = fileMonitor;
        this._cacheManager = new CacheManager();
        this._settingsManager = settingsManager;
    }

    _isDeepIconSearchEnabled() {
        if (!this._settingsManager) {
            return false;
        }
        try {
            return this._settingsManager.getDeepIconSearch();
        } catch (e) {
            logError(`Failed to read deep-icon-search setting: ${e.message}`);
            return false;
        }
    }

    _resolveIconPath(appName, cachedIcon) {
        if (appName) {
            let hicolorDir = GLib.build_pathv('/', [GLib.get_user_data_dir(), 'icons', 'hicolor']);
            let pngPath = GLib.build_pathv('/', [hicolorDir, '256x256', 'apps', `${appName}.png`]);
            if (Gio.File.new_for_path(pngPath).query_exists(null)) {
                return pngPath;
            }
            let scalableSvgPath = GLib.build_pathv('/', [hicolorDir, 'scalable', 'apps', `${appName}.svg`]);
            if (Gio.File.new_for_path(scalableSvgPath).query_exists(null)) {
                return scalableSvgPath;
            }
            let oldSvgPath = GLib.build_pathv('/', [hicolorDir, '256x256', 'apps', `${appName}.svg`]);
            if (Gio.File.new_for_path(oldSvgPath).query_exists(null)) {
                return oldSvgPath;
            }
        }
        if (cachedIcon && Gio.File.new_for_path(cachedIcon).query_exists(null)) {
            return cachedIcon;
        }
        return null;
    }

    async addAppImage(filePath) {
        let cached = await this._cacheManager.get(filePath);
        if (cached) {
            let iconPath = this._resolveIconPath(cached.name, cached.icon);
            if (!iconPath) {
                cached = null;
            } else {
                cached.icon = iconPath;
                let launcherExists = this._launcherService.launcherExists(cached.name);
                if (launcherExists) {
                    if (!await this._launcherService.hasValidIcon(cached.name)) {
                        log(`Launcher for ${cached.name} has fallback icon. Recreating launcher with valid icon.`);
                        this._launcherService.createLauncher(cached);
                        await this._cacheManager.add(cached);
                    } else {
                        log(`Skipping already cached AppImage: ${filePath}`);
                    }
                    return;
                }

                log(`Launcher for cached AppImage ${filePath} is missing. Recreating.`);
                this._launcherService.createLauncher(cached);
                await this._cacheManager.add(cached);
                return;
            }
        }

        if (!this.isAppImage(filePath)) {
            return;
        }

        this.ensureExecutable(filePath);
        const metadata = await this.extractMetadata(filePath);

        if (this._fileMonitor) {
            this._fileMonitor.pause();
        }

        this._launcherService.createLauncher(metadata);
        await this._cacheManager.add(metadata);

        if (this._fileMonitor) {
            this._fileMonitor.resume();
        }
    }

    async removeAppImage(filePath) {
        const cached = await this._cacheManager.get(filePath);
        let appName;
        if (cached && cached.name) {
            appName = cached.name;
        } else if (this.isAppImage(filePath)) {
            let fileName = GLib.path_get_basename(filePath);
            appName = fileName.replace(/\.AppImage$/i, '');
        } else {
            return;
        }

        this._launcherService.deleteLauncher(appName);
        if (cached && cached.icon) {
            let iconFile = Gio.File.new_for_path(cached.icon);
            if (iconFile.query_exists(null)) {
                try {
                    iconFile.delete(null);
                    log(`Deleted cached icon for ${appName} at ${cached.icon}`);
                } catch (e) {
                    logError(`Failed to delete icon for ${appName}: ${e.message}`);
                }
            }
        }
        await this._cacheManager.remove(filePath);
    }

    getCache() {
        return this._cacheManager.getCachedDataSync();
    }

    isAppImage(filePath) {
        // As per clarification, identify by .AppImage extension
        return filePath.toLowerCase().endsWith('.appimage');
    }

    ensureExecutable(filePath) {
        let file = Gio.File.new_for_path(filePath);
        try {
            let info = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
            let mode = info.get_attribute_uint32('unix::mode');

            if (!(mode & 0o100)) {
                mode |= 0o100;
                file.set_attribute_uint32('unix::mode', mode, Gio.FileQueryInfoFlags.NONE, null);
                log(`Made AppImage executable: ${filePath}`);
            }
        } catch (e) {
            logError(`Failed to make AppImage executable (filesystem may not support UNIX permissions): ${e.message}`);
        }
    }

    async extractMetadata(filePath) {
        const extractedMetadata = await this._extractAppImageMetadata(filePath);

        if (!extractedMetadata) {
            // Fallback to old method if metadata extraction fails
            let fileName = GLib.path_get_basename(filePath);
            let name = fileName.replace(/\.AppImage$/, ''); // Remove .AppImage extension
            name = name.replace(/[-._\s](v\d+(\.\d+){1,2}|\d+\.\d+\.\d+).*$/i, '');
            name = name.replace(/[-_.]/g, ' ').trim();
            name = name.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

            return {
                name: name,
                path: filePath,
                icon: null,
                categories: ['Utility'], // Placeholder
                desktopFilePath: null,
                desktopContent: null
            };
        }

        return {
            name: extractedMetadata.name,
            path: filePath,
            icon: extractedMetadata.icon,
            categories: ['Utility'], // Placeholder
            desktopFilePath: null,
            desktopContent: extractedMetadata.desktopContent
        };
    }

    async _extractAppImageMetadata(filePath) {
        let tempDir = Gio.File.new_for_path(GLib.build_pathv('/', [GLib.get_tmp_dir(), GLib.uuid_string_random()]));
        tempDir.make_directory_with_parents(null);

        try {
            log(`Extracting ${filePath} to ${tempDir.get_path()}`);
            let [success, pid] = GLib.spawn_async(
                tempDir.get_path(),
                [filePath, '--appimage-extract'],
                null,
                GLib.SpawnFlags.DO_NOT_REAP_CHILD,
                null
            );

            if (!success) {
                logError('Failed to run --appimage-extract');
                return null;
            }

            await new Promise(resolve => {
                GLib.child_watch_add(GLib.PRIORITY_DEFAULT, pid, (pid, status) => {
                    GLib.spawn_close_pid(pid);
                    log(`Extraction process for ${filePath} finished with status ${status}`);
                    resolve();
                });
            });

            let squashfsRoot = tempDir.get_child('squashfs-root');
            if (!squashfsRoot.query_exists(null)) {
                logError('squashfs-root not found');
                return null;
            }

            const desktopFileMetadata = await this._findAndParseDesktopFile(squashfsRoot);
            let appName = desktopFileMetadata ? desktopFileMetadata.name : null;
            if (!appName) {
                let fileName = GLib.path_get_basename(filePath);
                appName = fileName.replace(/\.AppImage$/i, '');
            }

            let iconPath = this._findIcon(
                squashfsRoot,
                desktopFileMetadata ? desktopFileMetadata.icon : null,
                appName
            );
            if (!iconPath) {
                logError('Icon not found in squashfs-root');
                return null;
            }

            let iconFile = Gio.File.new_for_path(iconPath);
            let extension = 'png';
            if (iconPath.toLowerCase().endsWith('.svg')) {
                extension = 'svg';
            } else if (iconPath.toLowerCase().endsWith('.png')) {
                extension = 'png';
            } else {
                try {
                    let info = iconFile.query_info('standard::content-type', Gio.FileQueryInfoFlags.NONE, null);
                    let contentType = info.get_content_type();
                    if (contentType && (contentType.includes('svg') || contentType.includes('xml'))) {
                        extension = 'svg';
                    }
                } catch (e) {
                    // Fallback to png
                }
            }

            let subDir = extension === 'svg' ? 'scalable' : '256x256';
            let iconDir = Gio.File.new_for_path(GLib.build_pathv('/', [GLib.get_user_data_dir(), 'icons', 'hicolor', subDir, 'apps']));
            if (!iconDir.query_exists(null)) {
                iconDir.make_directory_with_parents(null);
            }

            let newIconFile = iconDir.get_child(`${appName}.${extension}`);
            iconFile.copy(newIconFile, Gio.FileCopyFlags.OVERWRITE, null, null);

            return {
                name: appName,
                icon: newIconFile.get_path(),
                desktopContent: desktopFileMetadata ? desktopFileMetadata.desktopContent : null
            };
        } finally {
            log(`Deleting directory: ${tempDir.get_path()}`);
            this._deleteDirectoryRecursive(tempDir);
        }
    }

    async _findAndParseDesktopFile(squashfsRoot) {
        let enumerator = squashfsRoot.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let fileInfo;
        let desktopFile = null;

        while ((fileInfo = enumerator.next_file(null)) !== null) {
            let name = fileInfo.get_name();
            if (name.endsWith('.desktop')) {
                desktopFile = squashfsRoot.get_child(name);
                break;
            }
        }
        enumerator.close(null);

        if (!desktopFile) {
            return null;
        }

        try {
            const contents = await new Promise((resolve, reject) => {
                desktopFile.load_contents_async(null, (file, res) => {
                    try {
                        let [success, contents] = file.load_contents_finish(res);
                        if (success) {
                            resolve(contents);
                        } else {
                            resolve(null);
                        }
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            if (!contents) {
                return null;
            }

            const decoder = new TextDecoder('utf-8');
            const contentsStr = decoder.decode(contents);

            let name = null;
            let icon = null;

            for (const line of contentsStr.split('\n')) {
                if (line.startsWith('Name=')) {
                    name = line.substring(5).trim();
                } else if (line.startsWith('Icon=')) {
                    icon = line.substring(5).trim();
                }
            }

            return { name, icon, desktopContent: contentsStr };
        } catch (e) {
            logError(`Failed to read desktop file: ${e.message}`);
            return null;
        }
    }

    _findIcon(squashfsRoot, iconName, appName = null) {
        let searchName = iconName || appName;
        let baseName = searchName ? searchName.replace(/\.[^/.]+$/, "") : null;

        // 1. Check icon file directly at the root (with exact name or common extensions)
        if (iconName) {
            let lowerName = iconName.toLowerCase();
            if (lowerName.endsWith('.png') || lowerName.endsWith('.svg') || lowerName.endsWith('.xpm') || lowerName.endsWith('.ico')) {
                let iconFile = squashfsRoot.get_child(iconName);
                if (iconFile.query_exists(null)) {
                    return iconFile.get_path();
                }
            }
        }
        if (baseName) {
            let iconFile = squashfsRoot.get_child(`${baseName}.png`);
            if (iconFile.query_exists(null)) {
                return iconFile.get_path();
            }
            iconFile = squashfsRoot.get_child(`${baseName}.svg`);
            if (iconFile.query_exists(null)) {
                return iconFile.get_path();
            }
        }

        // 2. Check .DirIcon (AppImage standard) at the root
        let dirIconFile = squashfsRoot.get_child('.DirIcon');
        if (dirIconFile.query_exists(null)) {
            return dirIconFile.get_path();
        }

        // 3. Check usr/share/pixmaps (common location for Linux icons)
        let usrSharePixmaps = Gio.File.new_for_path(GLib.build_pathv('/', [squashfsRoot.get_path(), 'usr', 'share', 'pixmaps']));
        if (usrSharePixmaps.query_exists(null)) {
            if (iconName) {
                let lowerName = iconName.toLowerCase();
                if (lowerName.endsWith('.png') || lowerName.endsWith('.svg') || lowerName.endsWith('.xpm') || lowerName.endsWith('.ico')) {
                    let iconFile = usrSharePixmaps.get_child(iconName);
                    if (iconFile.query_exists(null)) {
                        return iconFile.get_path();
                    }
                }
            }
            if (baseName) {
                let iconFile = usrSharePixmaps.get_child(`${baseName}.png`);
                if (iconFile.query_exists(null)) {
                    return iconFile.get_path();
                }
                iconFile = usrSharePixmaps.get_child(`${baseName}.svg`);
                if (iconFile.query_exists(null)) {
                    return iconFile.get_path();
                }
            }
        }

        // 4. Check usr/share/icons/hicolor (standard theme location)
        if (baseName) {
            let usrShareIcons = Gio.File.new_for_path(GLib.build_pathv('/', [squashfsRoot.get_path(), 'usr', 'share', 'icons']));
            if (usrShareIcons.query_exists(null)) {
                let hicolorDir = usrShareIcons.get_child('hicolor');
                if (hicolorDir.query_exists(null)) {
                    let themeEnumerator = hicolorDir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                    let themeInfo;
                    while ((themeInfo = themeEnumerator.next_file(null)) !== null) {
                        if (themeInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                            let sizeDir = hicolorDir.get_child(themeInfo.get_name());
                            let appsDir = sizeDir.get_child('apps');
                            if (appsDir.query_exists(null)) {
                                let iconFile = appsDir.get_child(`${baseName}.svg`);
                                if (iconFile.query_exists(null)) {
                                    themeEnumerator.close(null);
                                    return iconFile.get_path();
                                }
                                iconFile = appsDir.get_child(`${baseName}.png`);
                                if (iconFile.query_exists(null)) {
                                    themeEnumerator.close(null);
                                    return iconFile.get_path();
                                }
                            }
                        }
                    }
                    themeEnumerator.close(null);
                }
            }
        }

        // 5. Deep search (if enabled by configuration)
        if (this._isDeepIconSearchEnabled() && baseName) {
            let deepPath = this._deepSearchIcon(squashfsRoot, baseName);
            if (deepPath) {
                return deepPath;
            }
        }

        // 6. Fallback to existing recursive search
        return this._findIconRecursive(squashfsRoot);
    }

    _deepSearchIcon(directory, baseName) {
        // Step A: Search for exact matches recursively
        let exactMatch = this._findIconExactRecursive(directory, baseName.toLowerCase());
        if (exactMatch) {
            return exactMatch;
        }

        // Step B: Search for partial matches containing baseName recursively
        let partialMatch = this._findIconPartialRecursive(directory, baseName.toLowerCase());
        if (partialMatch) {
            return partialMatch;
        }

        return null;
    }

    _findIconExactRecursive(directory, lowerBaseName) {
        let enumerator;
        try {
            enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return null;
        }

        let fileInfo;
        let foundPath = null;
        let subdirs = [];

        while ((fileInfo = enumerator.next_file(null)) !== null) {
            let child = directory.get_child(fileInfo.get_name());
            if (fileInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                subdirs.push(child);
            } else {
                let name = fileInfo.get_name().toLowerCase();
                if (name === `${lowerBaseName}.png` || name === `${lowerBaseName}.svg`) {
                    foundPath = child.get_path();
                    break;
                }
            }
        }
        enumerator.close(null);

        if (foundPath) {
            return foundPath;
        }

        for (let subdir of subdirs) {
            foundPath = this._findIconExactRecursive(subdir, lowerBaseName);
            if (foundPath) {
                return foundPath;
            }
        }

        return null;
    }

    _findIconPartialRecursive(directory, lowerBaseName) {
        let enumerator;
        try {
            enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return null;
        }

        let fileInfo;
        let foundPath = null;
        let subdirs = [];

        while ((fileInfo = enumerator.next_file(null)) !== null) {
            let child = directory.get_child(fileInfo.get_name());
            if (fileInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                subdirs.push(child);
            } else {
                let name = fileInfo.get_name().toLowerCase();
                if ((name.endsWith('.png') || name.endsWith('.svg')) && name.includes(lowerBaseName)) {
                    foundPath = child.get_path();
                    break;
                }
            }
        }
        enumerator.close(null);

        if (foundPath) {
            return foundPath;
        }

        for (let subdir of subdirs) {
            foundPath = this._findIconPartialRecursive(subdir, lowerBaseName);
            if (foundPath) {
                return foundPath;
            }
        }

        return null;
    }

    _findIconRecursive(directory) {
        let enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        let fileInfo;
        while ((fileInfo = enumerator.next_file(null)) !== null) {
            let child = directory.get_child(fileInfo.get_name());
            if (fileInfo.get_file_type() === Gio.FileType.DIRECTORY) {
                let iconPath = this._findIconRecursive(child);
                if (iconPath) {
                    enumerator.close(null);
                    return iconPath;
                }
            } else {
                let name = fileInfo.get_name();
                if (name.endsWith('.png') || name.endsWith('.svg')) {
                    if (name.toLowerCase().includes('icon') || name.toLowerCase().includes('logo')) {
                        enumerator.close(null);
                        return child.get_path();
                    }
                }
            }
        }
        enumerator.close(null);

        // If no icon with 'icon' or 'logo' in the name is found, return the first one
        enumerator = directory.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
        while ((fileInfo = enumerator.next_file(null)) !== null) {
            let child = directory.get_child(fileInfo.get_name());
            if (fileInfo.get_file_type() !== Gio.FileType.DIRECTORY) {
                let name = fileInfo.get_name();
                if (name.endsWith('.png') || name.endsWith('.svg')) {
                    enumerator.close(null);
                    return child.get_path();
                }
            }
        }
        enumerator.close(null);

        return null;
    }

    _deleteDirectoryRecursive(directory) {
        log(`Deleting directory asynchronously: ${directory.get_path()}`);
        try {
            GLib.spawn_async(
                null,
                ['rm', '-rf', directory.get_path()],
                null,
                GLib.SpawnFlags.SEARCH_PATH,
                null
            );
        } catch (e) {
            logError(`Failed to spawn rm -rf for directory ${directory.get_path()}: ${e.message}`);
        }
    }

    async rescan(directory) {
        const directoryFile = Gio.File.new_for_path(directory);
        const enumerator = directoryFile.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let fileInfo;
        const filesInDirectory = new Set();

        while ((fileInfo = enumerator.next_file(null)) !== null) {
            const fileName = fileInfo.get_name();
            const filePath = GLib.build_pathv('/', [directory, fileName]);
            filesInDirectory.add(filePath);
            if (this.isAppImage(filePath)) {
                await this.addAppImage(filePath);
            }
        }

        const cachedAppImages = await this._cacheManager.getAll();
        for (const appImagePath in cachedAppImages) {
            if (!filesInDirectory.has(appImagePath)) {
                await this.removeAppImage(appImagePath);
            }
        }
    }
}