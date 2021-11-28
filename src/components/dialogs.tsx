import * as React from 'react';
import { Dialog, ReactWidget, showDialog } from '@jupyterlab/apputils';
import { TranslationBundle } from '@jupyterlab/translation';
import { IAlternativeFormat, IDetectionResult } from '../types';

export function migrationDialog(
  format: IAlternativeFormat<any>,
  detectionResult: IDetectionResult,
  path: string,
  trans: TranslationBundle
): Promise<Dialog.IResult<void>> {
  const migrateButton = Dialog.okButton({
    label: trans.__('Migrate'),
    accept: true
  });
  return showDialog({
    title: trans.__('Importing %1 citations is possible', format.name),
    body: (
      <div>
        <p>
          {trans._n(
            'Detected %1 citation in %2 format in %3.',
            'Detected %1 citations in %2 format in %3.',
            detectionResult.citationsDetected,
            format.name,
            path
          )}
        </p>
        <p>
          {trans._n(
            'Would you like to migrate this citation to Citation Manager format?',
            'Would you like to migrate these citations to Citation Manager format?',
            detectionResult.citationsDetected
          )}
        </p>
      </div>
    ),
    buttons: [Dialog.cancelButton(), migrateButton],
    defaultButton: 1
  });
}

class AccessKeyDialog extends ReactWidget {
  protected input: HTMLInputElement | null = null;
  constructor(protected trans: TranslationBundle) {
    super();
  }
  render() {
    return (
      <div className={'cm-AccessKeyDialog'}>
        <p>
          {this.trans.__(
            'In order to access your Zotero collection you need to configure Zotero API key.'
          )}
        </p>
        <p>
          {this.trans.__(
            'You can generate the API key after logging to Zotero:'
          )}{' '}
          <a href={'https://www.zotero.org'} target={'_blank'}>
            www.zotero.org
          </a>
        </p>
        <input
          ref={input => {
            this.input = input;
          }}
          placeholder={this.trans.__(
            'Enter a key in format of: P9NiFoyLeZu2bZNvvuQPDWsd'
          )}
          className={'jp-mod-styled cm-zotero-key-input'}
          type={'password'}
        />
      </div>
    );
  }
  getValue(): string {
    return this.input ? this.input.value : '';
  }
}

export function getAccessKeyDialog(
  trans: TranslationBundle
): Promise<Dialog.IResult<string>> {
  return showDialog<string>({
    title: trans.__('Configure Zotero API Access Key'),
    body: new AccessKeyDialog(trans),
    buttons: [
      Dialog.cancelButton({
        label: trans.__('Remind me later'),
        className: 'cm-remind-later'
      }),
      Dialog.okButton({
        label: trans.__('Approve and synchronise'),
        className: 'cm-approve-and-sync'
      })
    ],
    // TODO: bug upstream?
    focusNodeSelector: 'input[type="password"]'
  });
}
