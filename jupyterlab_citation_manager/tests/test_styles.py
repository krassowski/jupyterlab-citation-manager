from ..styles import _extract_info


def test_extract():
    style = _extract_info('jupyterlab_citation_manager/tests/resources/apa.csl')
    assert style['id'] == 'http://www.zotero.org/styles/apa'
    assert style['title'] == 'American Psychological Association 7th edition'
    assert style['shortTitle'] == 'APA'
    assert style['rights'] == 'This work is licensed under a Creative Commons Attribution-ShareAlike 3.0 License'
    assert style['license'] == 'http://creativecommons.org/licenses/by-sa/3.0/'
    assert style['fields'] == ['psychology', 'generic-base']
    assert style['authors'] == ['Brenton M. Wiernik']
    assert style['contributors'] == []
