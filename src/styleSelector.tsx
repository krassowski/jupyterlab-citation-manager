import IMatchResult = StringExt.IMatchResult;
import { IStyle } from './types';
import { IOption, Selector } from './selector';
import { TranslationBundle } from '@jupyterlab/translation';
import { StringExt } from '@lumino/algorithm';
import * as React from 'react';

interface IStyleOption {
  style: IStyle;
}

interface IStyleOptionMatch {
  title: IMatchResult | null;
}

export class StyleSelector extends Selector<IStyleOption, IStyleOptionMatch> {
  /**
   * Fields that will be used to filter down the initial list of citation styles.
   *
   * More styles will become available once you start typing.
   * TODO: make this user-customizable in settings?
   */
  preferredFields: string[] = ['generic-base'];

  constructor(protected trans: TranslationBundle) {
    super();
  }

  protected getInitialOptions(): IStyleOption[] {
    return this.options.filter(style =>
      this.preferredFields.some(field =>
        style.style.info.fields.includes(field)
      )
    );
  }

  filterOption(option: IOption<IStyleOption, IStyleOptionMatch>): boolean {
    return !!option.match?.title;
  }

  matchOption(option: IStyleOption, query: string): IStyleOptionMatch {
    query = query.toLowerCase();
    const style = option.style;
    const titleMatch = StringExt.matchSumOfSquares(
      (style.info.title || '').toLowerCase(),
      query
    );
    return {
      title: titleMatch
    };
  }

  sortOptions(
    a: IOption<IStyleOption, IStyleOptionMatch>,
    b: IOption<IStyleOption, IStyleOptionMatch>
  ): number {
    // TODO show generic-base (and maybe others) higher
    return (
      (a.match?.title?.score || Infinity) - (b.match?.title?.score || Infinity)
    );
  }

  protected renderOption(props: {
    option: IOption<IStyleOption, IStyleOptionMatch>;
  }): JSX.Element {
    const data = props.option.data;
    // TODO: show license, authors, short title and fields tags
    return <div className={'cm-Option-content'}>{data.style.info.title}</div>;
  }
}
