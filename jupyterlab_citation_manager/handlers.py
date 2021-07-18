import re

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join

import tornado
from tornado.web import StaticFileHandler

from .styles import discover_styles, styles_to_url
from ._version import __version__


class StylesManagerHandler(APIHandler):

    styles = []

    # The following decorator should be present on all verb methods (head, get, post,
    # patch, put, delete, options) to ensure only authorized user can request the
    # Jupyter server
    @tornado.web.authenticated
    def get(self):
        self.finish({
            'version': __version__,
            'styles': self.styles
        })


def setup_handlers(web_app, url_path, server_app):
    styles = discover_styles(server_app)
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    handlers = []
    for style in styles:
        style_endpoint = url_path_join(base_url, url_path, 'styles', style['id'])
        handlers.append(
            (
                # see https://stackoverflow.com/a/27212892
                re.escape(style_endpoint) + '()',
                StaticFileHandler,
                {"path": style['path']}
            )
        )
    web_app.add_handlers(host_pattern, handlers)
    StylesManagerHandler.styles = styles_to_url(styles)

    route_pattern = url_path_join(base_url, url_path, "styles")
    handlers = [(route_pattern, StylesManagerHandler)]
    web_app.add_handlers(host_pattern, handlers)
