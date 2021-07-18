import { LabIcon } from '@jupyterlab/ui-components';
import * as React from 'react';

/**
 * React component mimicking ToolbarButton from core.
 */
export function ToolbarButton(props: {
  icon: LabIcon;
  execute: () => void;
  tooltip: string;
  label?: string;
}): JSX.Element {
  return (
    <div
      className={'lm-Widget jp-ToolbarButton jp-Toolbar-item'}
      onClick={props.execute}
      title={props.tooltip}
    >
      <button
        className={
          'bp3-button bp3-minimal jp-ToolbarButtonComponent minimal jp-Button'
        }
      >
        <span className={'bp3-button-text'}>
          <span className={'jp-ToolbarButtonComponent-icon'}>
            <props.icon.react />
          </span>
          {props.label}
        </span>
      </button>
    </div>
  );
}
