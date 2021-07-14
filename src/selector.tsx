/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/
import * as React from 'react';
import { ReactWidget, UseSignal } from '@jupyterlab/apputils';
import { Widget } from '@lumino/widgets';
import { Message } from '@lumino/messaging';
import { ICitationOption } from './types';
import { StringExt } from '@lumino/algorithm';
import IMatchResult = StringExt.IMatchResult;
import { ISignal, Signal } from '@lumino/signaling';
import { searchIcon } from '@jupyterlab/ui-components';

/**
 * TODO: implement a modal, command-palette like citation selector
 */
interface IYearMatch {
  absoluteDifference: number;
}

interface IOptionMatch {
  title: IMatchResult | null;
  year: IYearMatch | null;
  creators: (IMatchResult | null)[] | null;
}

function OptionTitle(props: {
  title: string | undefined;
  match: IMatchResult | null;
}) {
  return (
    <span className={'cm-title'}>
      {props.title
        ? props.match
          ? StringExt.highlight(props.title, props.match.indices, match => {
              return <mark>{match}</mark>;
            })
          : props.title
        : ''}
    </span>
  );
}

function CitationOption(props: {
  option: ICitationOption;
  match: IOptionMatch;
}) {
  const publication = props.option.publication;
  return (
    <li>
      <OptionTitle title={publication.title} match={props.match.title} />
      <span className={'cm-source'}>{props.option.source}</span>
      <span className={'cm-citationCount'}>
        {props.option.citationsInDocument}
      </span>
      <span className={'cm-year'}>{publication.date?.getFullYear()}</span>
      <span className={'cm-type'}>{publication.type}</span>
    </li>
  );
}

function matchOption(option: ICitationOption, query: string): IOptionMatch {
  query = query.toLowerCase();
  const publication = option.publication;
  const titleMatch = StringExt.matchSumOfDeltas(
    (publication.title || '').toLowerCase(),
    query
  );
  const regex = /\b((?:19|20)\d{2})\b/g;
  const queryYear = query.match(regex);
  let yearMatch: IYearMatch | null = null;
  if (queryYear) {
    yearMatch = {
      absoluteDifference: Math.abs(
        publication.date?.getFullYear
          ? publication.date?.getFullYear()
          : 0 - parseInt(queryYear[0], 10)
      )
    };
  }
  return {
    title: titleMatch,
    year: yearMatch,
    creators: publication.author
      ? publication.author.map(creator => {
          return StringExt.matchSumOfSquares(
            (creator.given + ' ' + creator.family).toLowerCase(),
            query
          );
        })
      : null
  };
}

interface IOptionAndMatch {
  match: IOptionMatch;
  option: ICitationOption;
}

function OptionsList(props: {
  signal: ISignal<CitationSelector, IOptionAndMatch[]>;
}) {
  return (
    <UseSignal signal={props.signal}>
      {(_, options: any) => {
        if (!options) {
          return '';
        }
        const optionItems = options.map((result: IOptionAndMatch) => {
          return (
            <CitationOption
              option={result.option}
              match={result.match}
              key={'selector-' + result.option.publication.id}
            />
          );
        });
        return <ul className={'cm-OptionList'}>{optionItems}</ul>;
      }}
    </UseSignal>
  );
}

export class CitationSelector extends ReactWidget {
  private _query: string;
  private _filteredOptions: IOptionAndMatch[];
  private _reject: () => void;
  private _accept: (option: ICitationOption) => void;
  private _previousPromise: Promise<ICitationOption> | null;
  private _optionsChanged: Signal<CitationSelector, IOptionAndMatch[]>;
  protected options: ICitationOption[];
  private _input: HTMLInputElement | null = null;

  constructor() {
    super();
    this._query = '';
    this.options = [];
    this._optionsChanged = new Signal(this);
    this._filteredOptions = this.optionsAlreadyPresentInDocument();
    this._reject = () => 0;
    this._accept = option => 0;
    this._previousPromise = null;
    this.addClass('cm-ModalSelector');
  }

  private optionsAlreadyPresentInDocument() {
    return this.options
      .filter(option => option.citationsInDocument > 0)
      .sort((a, b) => a.citationsInDocument - b.citationsInDocument)
      .map(option => {
        return {
          option: option,
          match: {
            title: null,
            year: null,
            creators: null
          }
        };
      });
  }

  getItem(options: ICitationOption[]) {
    if (this._previousPromise) {
      this._reject();
    }
    this.show();
    this.options = options;
    this._filteredOptions = this.optionsAlreadyPresentInDocument();
    console.log(this._filteredOptions);
    this._optionsChanged.emit(this._filteredOptions);
    if (!this.isAttached) {
      this.attach();
    }
    return new Promise<ICitationOption>((accept, reject) => {
      this._accept = accept;
      this._reject = reject;
    });
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
  hideAndReset(): void {
    this.hide();
    if (this._previousPromise) {
      this._reject();
    }
    this._previousPromise = null;
    if (this._input) {
      this._input.value = '';
    }
    //this._commandPalette.inputNode.value = '';
    //this._commandPalette.refresh();
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

  handleInput(event: React.FormEvent<HTMLInputElement>) {
    this._query = (event.target as HTMLInputElement).value;
    this._filteredOptions = this.options
      .map(option => {
        return {
          match: matchOption(option, this._query),
          option: option
        };
      })
      .filter(result => {
        return [
          result.match.title,
          result.match.year,
          result.match.creators
        ].filter(v => v !== null).length;
      })
      .sort((a, b) => {
        return (
          (a.match.title?.score || Infinity) -
          (b.match.title?.score || Infinity)
        );
      });
    this._optionsChanged.emit(this._filteredOptions);
  }

  render() {
    // TODO: 1. make it update listing on filtering
    // TODO: 2. make it NOT change input
    // TODO: 3. make it focus the input
    console.log('aaaa');
    return (
      <div className={'cm-Selector'}>
        <div className={'cm-SearchField-wrapper'}>
          <input
            placeholder={'Start typing title, author, or year'}
            onInput={this.handleInput.bind(this)}
            className={'cm-SearchField'}
            ref={input => {
              this._input = input;
            }}
            autoFocus
          />
          <searchIcon.react className={'cm-SearchIcon'} />
        </div>
        <OptionsList signal={this._optionsChanged} />
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
        if (this._filteredOptions.length) {
          this._accept(this._filteredOptions[0].option);
        } else {
          if (this._previousPromise) {
            this._reject();
          }
        }
        this._previousPromise = null;
        this.hide();
        break;
      default:
        break;
    }
  }
}
