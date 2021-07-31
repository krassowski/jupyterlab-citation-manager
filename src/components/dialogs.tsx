import * as React from 'react';
import { Dialog, showDialog } from '@jupyterlab/apputils';
import { TranslationBundle } from '@jupyterlab/translation';
import { IAlternativeFormat, IDetectionResult } from '../types';

export function migrationDialog(
  format: IAlternativeFormat<any>,
  detectionResult: IDetectionResult,
  path: string,
  trans: TranslationBundle
) {
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
