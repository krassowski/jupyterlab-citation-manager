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
import { ElementExt } from '@lumino/domutils';
import { UUID } from '@lumino/coreutils';
import { Debouncer } from '@lumino/polling';

export interface IOption<D = any, M = any> {
  id: string;
  match: M | null;
  data: D;
}

const ACTIVE_CLASS = 'cm-mod-active';
const FOCUS_CLASS = 'lm-mod-focused';

export function anonymousMark(match: string): JSX.Element {
  return <mark key={UUID.uuid4()}>{match}</mark>;
}

export namespace Selector {
  export interface IModel<O, M> {
    match(option: O, query: string): M;
    filter(option: IOption<O, M>): boolean;
    sort(a: IOption<O, M>, b: IOption<O, M>): number;
    initialOptions?(options: O[]): O[];
  }
  export interface IConfiguration<O, M> {
    /**
     * How long should the debouncer wait (ms)?
     */
    debounceRate?: number;
    /**
     * Debounce if as many options are to be displayed
     */
    debounceOptionNumberThreshold?: number;
    model: IModel<O, M>;
  }
}

export abstract class Selector<O, M> extends ReactWidget {
  protected _query: string;
  protected _filteredOptions: IOption<O, M>[];
  protected _reject: () => void;
  protected _accept: (option: O) => void;
  protected _previousPromise: Promise<O> | null;
  protected readonly _optionsChanged: Signal<
    Selector<any, any>,
    IOption<O, M>[]
  >;
  protected input: HTMLInputElement | null = null;
  protected options: O[];
  protected activeIndex: number;
  protected defaultConfig: Partial<Selector.IConfiguration<O, M>> = {
    debounceRate: 250,
    debounceOptionNumberThreshold: 200
  };
  protected _config: Selector.IConfiguration<O, M>;
  private _debouncedChanged: Debouncer;
  protected activeChanged: Signal<Selector<any, any>, O>;

  protected get model(): Selector.IModel<O, M> {
    return this._config.model;
  }

  protected constructor(config: Selector.IConfiguration<O, M>) {
    super();
    this._config = { ...this.defaultConfig, ...config };
    this._debouncedChanged = new Debouncer(() => {
      this.emitChangedSignal();
    }, this._config.debounceRate);
    this._query = '';
    this.options = [];
    this._optionsChanged = new Signal(this);
    this._filteredOptions = this.transformOptions(this.getInitialOptions());
    this._reject = () => 0;
    this._accept = option => 0;
    this._previousPromise = null;
    this.activeIndex = 0;
    this.activeChanged = new Signal(this);
    // required to receive blur and focus events
    this.node.tabIndex = 0;
  }

  placeholder = 'Search';

  protected emitChangedSignal(): void {
    this._optionsChanged.emit(this._filteredOptions);
  }

  protected createID(option: O): string {
    return JSON.stringify(option);
  }

  protected getInitialOptions(): O[] {
    if (this.model.initialOptions) {
      return this.model.initialOptions(this.options);
    }
    return [];
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

  protected getOptionNodes(): NodeListOf<HTMLLIElement> {
    return this.node.querySelectorAll('.cm-OptionsList li.cm-Option');
  }

  protected handleInput(event: React.FormEvent<HTMLInputElement>): void {
    this._query = (event.target as HTMLInputElement).value;
    this._filteredOptions = this.options
      .map(option => {
        return {
          match: this.model.match(option, this._query),
          data: option,
          id: this.createID(option)
        };
      })
      .filter(this.model.filter)
      .sort(this.model.sort);

    this.setActiveIndex(0);
    this._debouncedChanged.invoke().catch(console.warn);
  }

  protected renderOption(props: { option: IOption<O, M> }): JSX.Element {
    const data = props.option.data;
    return <div className={'cm-Option-content'}>{JSON.stringify(data)}</div>;
  }

  protected dynamicClassForList(options: IOption<O, M>[]): string {
    return '';
  }

  render(): JSX.Element {
    const renderOptions = (_: any, data: any) => {
      const options = data as IOption[];
      if (!options) {
        return '';
      }

      const optionItems = options.map((result, i) => {
        const accept = () => {
          this.acceptOption(result.data);
        };

        const isActive = this.activeIndex === i;
        const className = isActive ? `cm-Option ${ACTIVE_CLASS}` : 'cm-Option';

        const RenderOption = this.renderOption.bind(this);

        return (
          <li className={className} key={result.id} onClick={accept.bind(this)}>
            <RenderOption option={result} />
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
                this.input = input;
              }}
              onBlur={() => {
                if (!this.input || !this.input.parentElement) {
                  return;
                }
                this.input.parentElement.classList.remove(FOCUS_CLASS);
              }}
              onFocus={() => {
                if (!this.input || !this.input.parentElement) {
                  return;
                }
                this.input.parentElement.classList.add(FOCUS_CLASS);
              }}
              autoFocus
            />
            <searchIcon.react className={'cm-SearchIcon'} />
          </div>
        </div>
        <UseSignal
          signal={this._optionsChanged}
          initialArgs={this._filteredOptions}
        >
          {renderOptions.bind(this)}
        </UseSignal>
      </div>
    );
  }

  /**
   * Hide the modal command palette and reset its search.
   */
  protected hideAndReset(): void {
    this.hide();
    if (this._previousPromise) {
      this._reject();
    }
    this._previousPromise = null;
    if (this.input) {
      this.input.value = '';
    }
  }

  acceptOption(option?: O): void {
    if (!option) {
      if (this._filteredOptions.length) {
        option = this._filteredOptions[this.activeIndex].data;
      }
    }
    if (option) {
      const activeIndex = this._filteredOptions.findIndex(
        o => o.data === option
      );
      if (activeIndex !== -1) {
        this.setActiveIndex(activeIndex);
      }
      this._accept(option);
      this._previousPromise = null;
    } else {
      if (this._previousPromise) {
        this._reject();
        this._previousPromise = null;
      }
    }
  }

  protected setActiveIndex(index: number): void {
    const optionsNodes = this.getOptionNodes();
    if (!optionsNodes.length) {
      return;
    }
    optionsNodes[this.activeIndex].classList.remove(ACTIVE_CLASS);
    this.activeIndex = index;
    const activatedElement = optionsNodes[this.activeIndex];
    optionsNodes[this.activeIndex].classList.add(ACTIVE_CLASS);
    ElementExt.scrollIntoViewIfNeeded(
      activatedElement.parentElement as HTMLElement,
      activatedElement
    );
    this.activeChanged.emit(this._filteredOptions[this.activeIndex].data);
  }

  protected cycle(
    how: 'up' | 'down' | 'page up' | 'page down' | 'home' | 'end'
  ): void {
    const index = this.activeIndex;
    const options = this._filteredOptions;
    const pageSize = 10;
    let activeIndex: number;

    switch (how) {
      case 'down':
        activeIndex = index === options.length - 1 ? 0 : index + 1;
        break;
      case 'up':
        activeIndex = index === 0 ? options.length - 1 : index - 1;
        break;
      case 'page down':
        activeIndex =
          index + pageSize >= options.length - 1
            ? options.length - 1
            : index + pageSize;
        break;
      case 'page up':
        activeIndex = index - pageSize <= 0 ? 0 : index - pageSize;
        break;
      case 'end':
        activeIndex = options.length - 1;
        break;
      case 'home':
        activeIndex = 0;
        break;
    }
    this.setActiveIndex(activeIndex);
  }

  /**
   * Handle the `'keydown'` event for the widget.
   */
  protected _evtKeydown(event: KeyboardEvent): void {
    if (!event.target || !this.node.contains(event.target as Node)) {
      return;
    }
    switch (event.keyCode) {
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

  getItem(options: O[]): Promise<O> {
    if (this._previousPromise) {
      this._reject();
    }
    // first return index on old options to 0 (if any)
    this.setActiveIndex(0);
    this.options = options;
    this._filteredOptions = this.transformOptions(this.getInitialOptions());
    // ensure that items are updated if the react root was already attached
    this._optionsChanged.emit(this._filteredOptions);
    // set index on new options to zero
    this.setActiveIndex(0);
    return new Promise<O>((accept, reject) => {
      this._accept = accept;
      this._reject = reject;
    });
  }

  /**
   * Handle incoming events.
   */
  handleEvent(event: Event): void {
    switch (event.type) {
      case 'keydown':
        this._evtKeydown(event as KeyboardEvent);
        break;
      default:
        break;
    }
  }

  /**
   *  A message handler invoked on an `'after-attach'` message.
   */
  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    document.addEventListener('keydown', this, true);
  }

  /**
   *  A message handler invoked on an `'after-detach'` message.
   */
  protected onAfterDetach(msg: Message): void {
    document.removeEventListener('keydown', this, true);
  }
}

export abstract class ModalSelector<O, M> extends Selector<O, M> {
  protected constructor(config: Selector.IConfiguration<O, M>) {
    super(config);
    this.addClass('cm-ModalSelector');
    // required to receive blur and focus events
    this.node.tabIndex = 0;
  }

  /**
   * Handle the `'keydown'` event for the widget.
   */
  protected _evtKeydown(event: KeyboardEvent): void {
    switch (event.keyCode) {
      case 27: // Escape.
        event.stopPropagation();
        event.preventDefault();
        this.hideAndReset();
        break;
      default:
        super._evtKeydown(event);
        break;
    }
  }

  getItem(options: O[]): Promise<O> {
    const promise = super.getItem(options);
    // only show after updating initial options in parent implementation
    this.show();
    if (!this.isAttached) {
      this.attach();
    }
    return promise;
  }

  acceptOption(option?: O): void {
    super.acceptOption(option);
    this.hideAndReset();
  }

  attach(): void {
    Widget.attach(this, document.body);
  }

  detach(): void {
    Widget.detach(this);
  }

  /**
   * Handle incoming events.
   */
  handleEvent(event: Event): void {
    super.handleEvent(event);
    switch (event.type) {
      case 'blur': {
        // if the focus shifted outside of this DOM element, hide and reset.
        if (
          // focus went away from child element
          this.node.contains(event.target as HTMLElement) &&
          // and it did NOT go to another child element but someplace else
          !this.node.contains(
            (event as MouseEvent).relatedTarget as HTMLElement
          )
        ) {
          event.stopPropagation();
          this.hideAndReset();
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

  /**
   *  A message handler invoked on an `'after-attach'` message.
   */
  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.node.addEventListener('contextmenu', this, true);
  }

  /**
   *  A message handler invoked on an `'after-detach'` message.
   */
  protected onAfterDetach(msg: Message): void {
    super.onAfterDetach(msg);
    this.node.removeEventListener('contextmenu', this, true);
  }

  protected onBeforeHide(msg: Message): void {
    document.removeEventListener('blur', this, true);
  }

  protected onAfterShow(msg: Message): void {
    document.addEventListener('blur', this, true);
    if (this.input) {
      this.input.focus();
      window.setTimeout(() => {
        const input = this.input;
        if (!input) {
          console.warn('Input went away before focusing');
          return;
        }
        // notebook cells will try to steal the focus from selector - lets regain it immediately
        input.focus();
      }, 0);
    }
  }

  /**
   * A message handler invoked on an `'activate-request'` message.
   */
  protected onActivateRequest(msg: Message): void {
    if (this.isAttached) {
      this.show();
    }
  }
}
