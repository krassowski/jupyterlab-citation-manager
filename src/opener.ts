// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

// This file is based on the help-extension plugin from the core; to see the original contributors see
// https://github.com/jupyterlab/jupyterlab/blob/343da64508a87308e45bdf577007cff7f6538538/packages/help-extension/src/index.tsx

import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ITranslator } from '@jupyterlab/translation';
import { IFrame, MainAreaWidget, WidgetTracker } from '@jupyterlab/apputils';
import { CommandIDs } from './types';
import { URLExt } from '@jupyterlab/coreutils';
import { fileIcon } from '@jupyterlab/ui-components';

const PLUGIN_ID = 'jupyterlab-citation-manager:opener';

/**
 * A flag denoting whether the application is loaded over HTTPS.
 */
const LAB_IS_SECURE = window.location.protocol === 'https:';

export const openerPlugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  autoStart: true,
  requires: [],
  optional: [ITranslator, ILayoutRestorer],
  activate: (
    app: JupyterFrontEnd,
    translator: ITranslator,
    restorer: ILayoutRestorer | null
  ): void => {
    let counter = 0;
    const trans = translator.load('jupyterlab-citation-manager');
    const namespace = 'jupyterlab-citation-manager';
    const tracker = new WidgetTracker<MainAreaWidget<IFrame>>({ namespace });

    function newIFrameWidget(
      url: string,
      text: string
    ): MainAreaWidget<IFrame> {
      // Allow scripts and forms so that things like
      // readthedocs can use their search functionality.
      // We *don't* allow same origin requests, which
      // can prevent some content from being loaded onto the
      // help pages.
      const content = new IFrame({
        sandbox: ['allow-scripts', 'allow-forms']
      });
      content.url = url;
      //content.addClass(HELP_CLASS);
      content.title.label = text;
      content.id = `${namespace}-${++counter}`;
      content.title.icon = fileIcon;
      const widget = new MainAreaWidget({ content });
      widget.addClass('jp-Help');
      return widget;
    }

    app.commands.addCommand(CommandIDs.open, {
      label: args => trans.__('Open "%1"', args['title'] as string),
      execute: args => {
        // TODO PMCID etc
        const url =
          (args['URL'] as string) ||
          (args['DOI'] ? 'https://doi.org/' + args['DOI'] : '');
        const text = args['title'] as string;
        const newBrowserTab = (args['newBrowserTab'] as boolean) || false;

        // If help resource will generate a mixed content error, load externally.
        if (
          newBrowserTab ||
          (LAB_IS_SECURE && URLExt.parse(url).protocol !== 'https:')
        ) {
          window.open(url);
          return;
        }

        const widget = newIFrameWidget(url, text);
        void tracker.add(widget);
        app.shell.add(widget, 'main');
        return widget;
      }
    });

    // Handle state restoration.
    if (restorer) {
      void restorer.restore(tracker, {
        command: CommandIDs.open,
        args: widget => ({
          URL: widget.content.url,
          title: widget.content.title.label
        }),
        name: widget => widget.content.url
      });
    }
  }
};
