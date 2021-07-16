# jupyterlab-citation-manager

![Github Actions Status](https://github.com/krassowski/jupyterlab-citation-manager/workflows/Build/badge.svg)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/krassowski/jupyterlab-citation-manager/main?urlpath=lab)

Citation Manager for JupyterLab. Currently supports Zotero.

Design goals:

- make the inline-citations contain some information needed to build bibliography
  should it be everything? maybe. But it should not occupy too much space in Markdown editor
- users should be able to add citations manually by adding <cite>
- the extension should allow integration with services other than zotero

## Requirements

* JupyterLab >= 3.0

## Install

To install the extension, execute:

```bash
pip install jupyterlab-citation-manager
```

## Uninstall

To remove the extension, execute:

```bash
pip uninstall jupyterlab-citation-manager
```

## Citation styles

This extension includes thousands citation styles form the
[official repository](https://github.com/citation-style-language/styles) of
[Citation Language Styles](https://citationstyles.org/) (CSL) project.

If you want to add a custom citation style, you can do so by placing a `.csl` file in `csl-styles` folder in one of the `data` locations as returned by:

```bash
jupyter --paths
```

The `.csl` file should follow CSL v1.0.1 specification (see [official CSL specification](https://docs.citationstyles.org/en/stable/specification.html)).

### Example

If `jupyter --paths` looks like:

```
config:
    /home/your_name/.jupyter
    /usr/local/etc/jupyter
    /etc/jupyter
data:
    /home/your_name/.local/share/jupyter
    /usr/local/share/jupyter
    /usr/share/jupyter
runtime:
    /home/your_name/.local/share/jupyter/runtime
```

and you want to add your modified version of APA style, you would put `my-custom-apa.csl` in `/home/your_name/.local/share/jupyter/csl-styles` (you will need to create this folder), so that the final structure looks similar to:

```
/home/your_name/.local/share/jupyter
├── csl-styles
│   └── my-custom-apa.csl
├── nbsignatures.db
├── notebook_secret
└── runtime
```

## Contributing

### Development install

Note: You will need NodeJS to build the extension package.

The `jlpm` command is JupyterLab's pinned version of
[yarn](https://yarnpkg.com/) that is installed with JupyterLab. You may use
`yarn` or `npm` in lieu of `jlpm` below.

```bash
# Clone the repo to your local environment
# Change directory to the jupyterlab-citation-manager directory
# Install package in development mode
pip install -e .
# Link your development version of the extension with JupyterLab
jupyter labextension develop . --overwrite
# Rebuild extension Typescript source after making changes
jlpm run build
```

You can watch the source directory and run JupyterLab at the same time in different terminals to watch for changes in the extension's source and automatically rebuild the extension.

```bash
# Watch the source directory in one terminal, automatically rebuilding when needed
jlpm run watch
# Run JupyterLab in another terminal
jupyter lab
```

With the watch command running, every saved change will immediately be built locally and available in your running JupyterLab. Refresh JupyterLab to load the change in your browser (you may need to wait several seconds for the extension to be rebuilt).

By default, the `jlpm run build` command generates the source maps for this extension to make it easier to debug using the browser dev tools. To also generate source maps for the JupyterLab core extensions, you can run the following command:

```bash
jupyter lab build --minimize=False
```

### Development uninstall

```bash
pip uninstall jupyterlab-citation-manager
```

In development mode, you will also need to remove the symlink created by `jupyter labextension develop`
command. To find its location, you can run `jupyter labextension list` to figure out where the `labextensions`
folder is located. Then you can remove the symlink named `jupyterlab-citation-manager` within that folder.

### Updating citation styles

The citation styles are retrieved from the CSL repository using git submodules.
You can update the submodule to fetch the most recent citation styles:

```bash
# fetch the latest styles from the currently tracked CSL version branch
git submodule update csl-styles
# store the information about the most recent commit in version control
git commit csl-styles
```

To update the version branch:

```bash
# replace v1.0.1 with the version to track
git submodule set-branch --branch v1.0.1 csl-styles
git commit csl-styles
```