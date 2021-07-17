import logging
import platform
from pathlib import Path
from xml.etree import ElementTree

from jupyter_core.application import JupyterApp
from jupyter_core.paths import jupyter_path
from jupyter_server.utils import url_path_join


OS_SPECIFIC_PATHS = {
    'Linux': [
        # TODO: where does Zotero and others store styles?
    ],
    'Darwin': [
        # TODO: where does Zotero and others store styles?
    ],
    'Windows': [
        # TODO: where does Zotero and others store styles?
    ]
}


def _extract_info(path, ns='{http://purl.org/net/xbiblio/csl}'):
    tree = ElementTree.parse(path)
    root = tree.getroot()
    info = root.find(f'{ns}info')
    rights = info.find(f'{ns}rights')
    short_title = info.find(f'{ns}title-short')
    categories = info.findall(f'{ns}category')
    authors = info.findall(f'{ns}author')
    contributors = info.findall(f'{ns}contributors')

    def get_names(listing):
        results = []
        for element in listing:
            name = element.find(f'{ns}name')
            if not name:
                continue
            results.append(name)
        return results

    return {
        'id': info.find(f'{ns}id').text,
        'title': info.find(f'{ns}title').text,
        'shortTitle': short_title.text if short_title is not None else None,
        'rights': rights.text if rights is not None else None,
        'license': rights.attrib.get('license', None) if rights is not None else None,
        'authors': get_names(authors),
        # TODO: test with csl-styles/academy-of-management-review.csl (contributors) and apa.csl (no contributors)
        'contributors': get_names(contributors),
        # client will suggest those in 'generic-base' category first
        'fields': [
            category.attrib['field']
            for category in categories
            if 'field' in category.attrib
        ]
    }


def _scan_for_styles(data_path, log: logging.Logger):
    p = Path(data_path)
    print(p)
    style_files = list(p.glob('*.csl'))
    styles = []
    previous_identifiers = set()
    for style_path in style_files:
        path = style_path.parent

        base_name = style_path.name[:-4]

        if base_name in previous_identifiers:
            identifier = str(path / base_name)
        else:
            identifier = base_name
        previous_identifiers.add(identifier)

        try:
            info = _extract_info(style_path)
        except Exception as e:
            log.warning(
                f"Could not extract {identifier} style into in {path}:"
                f" {e}."
            )
            continue

        styles.append({
            'path': path,
            'shortId': base_name,
            'id': identifier,
            'csl': style_path.name,
            'info': info
        })
    return styles


def discover_styles(server_app: JupyterApp):
    data_paths = jupyter_path('csl-styles')
    system = platform.system()
    if system in OS_SPECIFIC_PATHS:
        data_paths.extend(OS_SPECIFIC_PATHS[system])
    # TODO: maybe use server_app.data_dir?

    server_app.log.info(f"Looking for CSL styles for Citation Manager in {data_paths}")
    styles = []
    for path in data_paths:
        styles.extend(_scan_for_styles(path, server_app.log))

    server_app.log.info(f"Located CSL {len(styles)} styles for Citation Manager.")
    return styles


def styles_to_url(styles, base_url):
    return [
        {
            **{
                k: v
                for k, v in style.items()
                if k not in {'path'}
            },
            'csl': url_path_join(base_url, style['id'], style['csl']),
        }
        for style in styles
    ]
