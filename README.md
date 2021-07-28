# jupyterlab-citation-manager

[![Github Actions Status](https://github.com/krassowski/jupyterlab-citation-manager/workflows/Build/badge.svg)](https://github.com/krassowski/jupyterlab-citation-manager/actions/workflows/build.yml)
[![Binder](https://mybinder.org/badge_logo.svg)](https://mybinder.org/v2/gh/krassowski/jupyterlab-citation-manager/main?urlpath=lab)

**Status: Work In Progress**. The underlying format may change; the support for migration from cite2c is provisional.
Use in production deployments is not currently recommended - only install this extension if you plan to give
feedback on the features and development directions.

Citation Manager for JupyterLab:
- enables adding citations to Jupyter notebooks in Markdown cells,
- keeps the bibliography in sync with the citations in the document,
- supports thousands of citation styles,
- offers a way to effectively search through your collection of references,
- integrates with the Zotero® service (Connector for Zotero) by default,
- is modular in design, allowing for integration of other reference managers in the future.

The data of each reference (a.k.a. *citable item*) is stored in the notebook metadata,
while a mapping between citation ID and the citable items is stored in the cell metadata.
- storing full data of each citable item in the notebook enables:
    - collaboration between multiple users with separate Zotero collections,
    - retaining the data for citation which got removed from private collection.
- storing mapping between citation and citable items in the cell metadata allows to copy cells between notebooks.

## Usage

### Authenticate with Zotero

To enable you to access your reference list you will need to obtain an access API key [from your Zotero account](https://www.zotero.org/settings/keys/new).
The most basic, read-only key is sufficient (and recommended). The key will be stored in your settings, so you will only need to enter it once.

### Insert citation

Insert citation by clicking on the insert citation button in the toolbar of your notebook (![add citation icon][book-plus]) or pressing <kbd>Alt</kbd> + <kbd>C</kbd> (hint: shortcut are customizable in Advanced Settings Editor).
Start typing to filter references by title, authors or year.

![animation of inserting citations][add-citation]

### Insert bibliography

Insert bibliography by clicking on the (![add bibliography icon][book-open-variant]) or pressing <kbd>Alt</kbd> + <kbd>B</kbd>.

![animation of inserting bibliography][add-bibliography]

### Change style

To change the citation style go to the sidebar (![sidebar icon][bookshelf]) and click on (![change style icon][palette]) or press <kbd>Alt</kbd> + <kbd>S</kbd>.
Only a subset of generic styles will be shown initially; start typing a name to find more specialised styles.

![animation of changing style][change-style]

### Synchronise references

To synchronise your collection of references go to the sidebar (![sidebar icon][bookshelf]) and click on (![refresh collection icon][refresh]) or press TODO.
Updating can take a few seconds; a progress bar will appear on the status bar to keep you updated (if you have it enabled).

### Explore your collection

To get the details on references in your collections without leaving JupyterLab open the sidebar (![sidebar icon][bookshelf]),
and start typing to find item of interest. You will be able to preview the abstract, check metadata and even
open the article inside JupyterLab (or in a new browser tab - depending on your preference).

References with citations in the current document will show on top when opening the explorer
and enable a quick preview of citation context and navigation to the relevant place in the document
(by clicking on the citation context).


[bookshelf]: https://raw.githubusercontent.com/krassowski/jupyterlab-citation-manager/main/style/icons/bookshelf.svg?sanitize=true
[book-open-variant]: https://raw.githubusercontent.com/krassowski/jupyterlab-citation-manager/main/style/icons/book-open-variant.svg?sanitize=true
[book-plus]: https://raw.githubusercontent.com/krassowski/jupyterlab-citation-manager/main/style/icons/bookshelf.svg?book-plus=true
[palette]: https://raw.githubusercontent.com/krassowski/jupyterlab-citation-manager/main/style/icons/palette.svg?sanitize=true
[refresh]: https://raw.githubusercontent.com/krassowski/jupyterlab-citation-manager/main/style/icons/refresh.svg?sanitize=true
[add-citation]: https://raw.githubusercontent.com/krassowski/jupyterlab-citation-manager/main/docs/images/add-citation.gif
[add-bibliography]: https://raw.githubusercontent.com/krassowski/jupyterlab-citation-manager/main/docs/images/add-bibliography.gif
[change-style]: https://raw.githubusercontent.com/krassowski/jupyterlab-citation-manager/main/docs/images/change-style.gif

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


## Advanced Usage

### Citation clusters

TODO

### Citation styles

This extension includes thousands citation styles form the
[official repository](https://github.com/citation-style-language/styles) of
[Citation Language Styles](https://citationstyles.org/) (CSL) project.

If you want to add a custom citation style, you can do so by placing a `.csl` file in `csl-styles` folder in one of the `data` locations as returned by:

```bash
jupyter --paths
```

The `.csl` file should follow CSL v1.0.1 specification (see [official CSL specification](https://docs.citationstyles.org/en/stable/specification.html)).

#### Example

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

### Legal notes

#### Connector for Zotero

Zotero is a registered trademark of the [Corporation for Digital Scholarship](http://digitalscholar.org/);
our extension (Connector for Zotero) is not affiliated with the Corporation in any way.

#### CSL styles

The CSL styles are contributed by individual authors to the CSL project; this extension

#### Icons

Please see the [`style/icons/README.md`](style/icons/README.md)
for information on the licences of icons included in the distribution;

### citeproc-js

`citeproc-js` is used by `jupyterlab-citation-manager` to format the citation and bibliography text; `citeproc-js` is
dual-licenced under CPAL 1.0 (or newer) or AGPLv3 (or newer); in order to allow for the distribution of this extension
with other works the CPAL 1.0 licence was adopted for re-distribution of `cireproc-js` together with this extension.
The Exhibit A of `citeproc-js` CPAL 1.0 licence is presented below for informational purposes:

> EXHIBIT A. Common Public Attribution License Version 1.0.
> “The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://opensource.org/licenses/CPAL-1.0. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
> Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
> The Original Code is citeproc-js.
> The Original Developer is not the Initial Developer and is __________. If left blank, the Original Developer is the Initial Developer.
> The Initial Developer of the Original Code is Frank Bennett. All portions of the code written by Frank Bennett are Copyright (c) 2009-2015. All Rights Reserved.
> Contributor ______________________.
> Alternatively, the contents of this file may be used under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE (the AGPLv3 License), in which case the provisions of AGPLv3 License are applicable instead of those above.
> If you wish to allow use of your version of this file only under the terms of the AGPLv3 License and not to allow others to use your version of this file under the CPAL, indicate your decision by deleting the provisions above and replace them with the notice and other provisions required by the AGPLv3 License. If you do not delete the provisions above, a recipient may use your version of this file under either the CPAL or the AGPLv3 License.”