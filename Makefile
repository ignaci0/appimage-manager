.PHONY: install uninstall build zip clean

UUID = appimage-manager@ignaci0
ZIP = $(UUID).shell-extension.zip
EXTRA_SOURCES = $(wildcard src/*.js)
EXTRA_SOURCE_ARGS = $(patsubst %,--extra-source=%,$(EXTRA_SOURCES))

install: zip
	gnome-extensions install --force $(ZIP)

uninstall:
	gnome-extensions uninstall $(UUID)

build: 
	gnome-extensions pack --force \
		--schema=src/schemas/org.gnome.shell.extensions.appimage-manager.gschema.xml \
		$(EXTRA_SOURCE_ARGS) \
		.

zip: build

clean:
	rm -f $(UUID).shell-extension.zip $(UUID).zip
	rm -f src/schemas/gschemas.compiled


