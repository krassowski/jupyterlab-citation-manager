/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/
import * as React from 'react';
import { ReactWidget, UseSignal } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import { Signal } from '@lumino/signaling';
import { searchIcon } from '@jupyterlab/ui-components';

export interface IOption<D = any, M = any> {
  id: string;
  match: M | null;
  data: D;
}

export abstract class Selector<O, M> extends ReactWidget {
  private _query: string;
  private _filteredOptions: IOption<O, M>[];
  private _reject: () => void;
  private _accept: (option: O) => void;
  private _previousPromise: Promise<O> | null;
  private readonly _optionsChanged: Signal<Selector<any, any>, IOption<O, M>[]>;
  private _input: HTMLInputElement | null = null;
  protected options: O[];
  protected activeIndex: number;

  protected constructor() {
    super();
    this._query = '';
    this.options = [];
    this._optionsChanged = new Signal(this);
    this._filteredOptions = this.transformOptions(this.getInitialOptions());
    this._reject = () => 0;
    this._accept = option => 0;
    this._previousPromise = null;
    this.activeIndex = 0;
    this.addClass('cm-ModalSelector');
  }

  abstract matchOption(option: O, query: string): M;
  abstract filterOption(option: IOption<O, M>): boolean;
  abstract sortOptions(a: IOption<O, M>, b: IOption<O, M>): number;
  placeholder = 'Search';

  getItem(options: O[]): Promise<O> {
    if (this._previousPromise) {
      this._reject();
    }
    this.activeIndex = 0;
    this.options = options;
    this._filteredOptions = this.transformOptions(this.getInitialOptions());
    this.show();
    console.log(this._filteredOptions);
    this._optionsChanged.emit(this._filteredOptions);
    if (!this.isAttached) {
      this.attach();
    }
    return new Promise<O>((accept, reject) => {
      this._accept = accept;
      this._reject = reject;
    });
  }

  protected createID(option: O): string {
    return JSON.stringify(option);
  }

  protected getInitialOptions(): O[] {
    return [];
  }

  attach(): void {
    Widget.attach(this, document.body);
  }

  detach(): void {
    Widget.detach(this);
  }

  /**
   * Hide the modal command palette and reset its search.
   */
  private hideAndReset(): void {
    this.hide();
    if (this._previousPromise) {
      this._reject();
    }
    this._previousPromise = null;
    if (this._input) {
      this._input.value = '';
    }
  }

  /**
   * Handle incoming events.
   */
  handleEvent(event: Event): void {
    switch (event.type) {
      case 'keydown':
        this._evtKeydown(event as KeyboardEvent);
        break;
      case 'focus': {
        // if the focus shifted outside of this DOM element, hide and reset.
        const target = event.target as HTMLElement;
        console.log('focus event', target);
        if (!this.node.contains(target as HTMLElement)) {
          console.log('resetting');
          event.stopPropagation();
          // TODO
          //this.hideAndReset();
        }
        break;
      }
      case 'contextmenu':
        event.preventDefault();
        event.stopPropagation();
        break;
      default:
        break;
    }
  }

  private transformOptions(options: O[]): IOption<O, M>[] {
    return options.map(option => {
      return {
        data: option,
        match: null,
        id: this.createID(option)
      } as IOption<O, M>;
    });
  }

  protected handleInput(event: React.FormEvent<HTMLInputElement>): void {
    this._query = (event.target as HTMLInputElement).value;
    this._filteredOptions = this.options
      .map(option => {
        return {
          match: this.matchOption(option, this._query),
          data: option,
          id: this.createID(option)
        };
      })
      .filter(this.filterOption)
      .sort(this.sortOptions);
    this._optionsChanged.emit(this._filteredOptions);
  }

  protected renderOption(props: { option: IOption<O, M> }): JSX.Element {
    const data = props.option.data;
    return <div className={'cm-Option-content'}>{{ data }}</div>;
  }

  protected dynamicClassForList(options: IOption<O, M>[]): string {
    return '';
  }

  render(): JSX.Element {
    // TODO: 2. make it NOT change input
    // TODO: 3. make it focus the input

    const renderOptions = (_: any, data: any) => {
      const options = data as IOption[];
      if (!options) {
        return '';
      }

      const optionItems = options.map((result, i) => {
        const accept = () => {
          this.acceptOption(result.data);
        };

        const className =
          this.activeIndex === i ? 'cm-Option cm-mod-active' : 'cm-Option';

        return (
          <li className={className} key={result.id} onClick={accept.bind(this)}>
            <this.renderOption option={result} />
          </li>
        );
      });

      return (
        <ul className={`cm-OptionsList ${this.dynamicClassForList(options)}`}>
          {optionItems}
        </ul>
      );
    };

    return (
      <div className={'cm-Selector'}>
        <div className={'cm-SearchField-outer-wrapper'}>
          <div className={'cm-SearchField-wrapper'}>
            <input
              placeholder={this.placeholder}
              onInput={this.handleInput.bind(this)}
              className={'cm-SearchField'}
              ref={input => {
                this._input = input;
              }}
              autoFocus
            />
            <searchIcon.react className={'cm-SearchIcon'} />
          </div>
        </div>
        <UseSignal signal={this._optionsChanged}>
          {renderOptions.bind(this)}
        </UseSignal>
      </div>
    );
  }

  /**
   *  A message handler invoked on an `'after-attach'` message.
   */
  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.node.addEventListener('keydown', this, true);
    this.node.addEventListener('contextmenu', this, true);
    if (this._input) {
      this._input.focus();
    }
  }

  /**
   *  A message handler invoked on an `'after-detach'` message.
   */
  protected onAfterDetach(msg: Message): void {
    this.node.removeEventListener('keydown', this, true);
    this.node.removeEventListener('contextmenu', this, true);
  }

  protected onBeforeHide(msg: Message): void {
    document.removeEventListener('focus', this, true);
  }

  protected onAfterShow(msg: Message): void {
    document.addEventListener('focus', this, true);
  }

  /**
   * A message handler invoked on an `'activate-request'` message.
   */
  protected onActivateRequest(msg: Message): void {
    if (this.isAttached) {
      this.show();
    }
  }

  acceptOption(option?: O): void {
    if (!option) {
      if (this._filteredOptions.length) {
        option = this._filteredOptions[this.activeIndex].data;
      }
    }
    if (option) {
      this._accept(option);
      this._previousPromise = null;
    } else {
      if (this._previousPromise) {
        this._reject();
        this._previousPromise = null;
      }
    }
    this.hideAndReset();
  }

  protected cycle(
    how: 'up' | 'down' | 'page up' | 'page down' | 'home' | 'end'
  ): void {
    const index = this.activeIndex;
    const options = this._filteredOptions;
    const pageSize = 10;
    switch (how) {
      case 'down':
        this.activeIndex = index === options.length - 1 ? 0 : index + 1;
        break;
      case 'up':
        this.activeIndex = index === 0 ? options.length - 1 : index - 1;
        break;
      case 'page down':
        this.activeIndex =
          index + pageSize >= options.length - 1
            ? options.length - 1
            : index + pageSize;
        break;
      case 'page up':
        this.activeIndex = index - pageSize <= 0 ? 0 : index - pageSize;
        break;
      case 'end':
        this.activeIndex = options.length - 1;
        break;
      case 'home':
        this.activeIndex = 0;
        break;
    }
    this._optionsChanged.emit(options);
  }

  /**
   * Handle the `'keydown'` event for the widget.
   */
  protected _evtKeydown(event: KeyboardEvent): void {
    // Check for escape key
    switch (event.keyCode) {
      case 27: // Escape.
        event.stopPropagation();
        event.preventDefault();
        this.hideAndReset();
        break;
      case 13: // Enter.
        this.acceptOption();
        break;
      case 40: // Down Arrow.
        this.cycle('down');
        break;
      case 38: // Up Arrow.
        this.cycle('up');
        break;
      case 34: // Page Down.
        this.cycle('page down');
        break;
      case 33: // Page Up.
        this.cycle('page up');
        break;
      case 35: // End.
        this.cycle('end');
        break;
      case 36: // Home.
        this.cycle('home');
        break;
      default:
        break;
    }
  }
}
