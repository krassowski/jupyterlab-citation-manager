import { ReactWidget, UseSignal } from '@jupyterlab/apputils';
import * as React from 'react';
import { ISignal } from '@lumino/signaling';
import { IProgress } from '../types';
import { ProgressBar } from '@jupyterlab/statusbar';

export class UpdateProgress extends ReactWidget {
  constructor(protected signal: ISignal<any, IProgress>) {
    super();
  }

  render(): JSX.Element {
    return (
      <UseSignal<any, IProgress> signal={this.signal}>
        {(sender, progress?: IProgress) => {
          if (!progress) {
            return null;
          }
          if (progress.state === 'started') {
            progress.value = 0;
          }
          if (progress.state === 'ongoing' && progress.value) {
            return (
              <div className={'cm-ProgressBar'} title={progress.tooltip || ''}>
                <span>{progress.label || ''}</span>
                <ProgressBar percentage={progress.value} />
              </div>
            );
          }
          return <div />;
        }}
      </UseSignal>
    );
  }
}
