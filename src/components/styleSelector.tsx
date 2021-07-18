import IMatchResult = StringExt.IMatchResult;
import { IStyle } from '../types';
import { anonymousMark, IOption, ModalSelector } from './selector';
import { TranslationBundle } from '@jupyterlab/translation';
import { StringExt } from '@lumino/algorithm';
import * as React from 'react';
import { InfinityIfMissing } from '../utils';

interface IStyleOption {
  style: IStyle;
}

interface IStyleOptionMatch {
  title: IMatchResult | null;
  shortTitle: IMatchResult | null;
}

export class StyleSelector extends ModalSelector<
  IStyleOption,
  IStyleOptionMatch
> {
  /**
   * Fields that will be used to filter down the initial list of citation styles.
   *
   * More styles will become available once you start typing.
   * TODO: make this user-customizable in settings? this can be also used for sorting
   *   (extra point for generic-base plus extra points for each user-specified field);
   *   would be good to have a list of all possible fields to validate the settings.
   */
  preferredFields: string[] = ['generic-base'];

  constructor(protected trans: TranslationBundle) {
    super();
    this.addClass('cm-StyleSelector');
  }

  protected getInitialOptions(): IStyleOption[] {
    return this.options.filter(style =>
      this.preferredFields.some(field =>
        style.style.info.fields.includes(field)
      )
    );
  }

  optionModel = {
    filter(option: IOption<IStyleOption, IStyleOptionMatch>): boolean {
      return !!option.match?.title || !!option.match?.shortTitle;
    },
    match(option: IStyleOption, query: string): IStyleOptionMatch {
      query = query.toLowerCase();
      const style = option.style;
      // TODO: edit distance
      const titleMatch = StringExt.matchSumOfSquares(
        (style.info.title || '').toLowerCase(),
        query
      );
      const shortTitleMatch = StringExt.matchSumOfSquares(
        (style.info.shortTitle || '').toLowerCase(),
        query
      );
      return {
        title: titleMatch,
        shortTitle: shortTitleMatch
      };
    },
    sort(
      a: IOption<IStyleOption, IStyleOptionMatch>,
      b: IOption<IStyleOption, IStyleOptionMatch>
    ): number {
      // TODO show generic-base (and maybe others) higher
      return (
        InfinityIfMissing(a.match?.shortTitle?.score) -
          InfinityIfMissing(b.match?.shortTitle?.score) ||
        InfinityIfMissing(a.match?.title?.score) -
          InfinityIfMissing(b.match?.title?.score)
      );
    }
  };
  protected renderOption(props: {
    option: IOption<IStyleOption, IStyleOptionMatch>;
  }): JSX.Element {
    const data = props.option.data;
    const info = data.style.info;
    const match = props.option.match;
    // TODO: show license, authors, and fields tags
    // TODO: also show the preview for the active item (maybe render in a promise to avoid delays?)
    //        maybe even as a dedicated side panel; this might be better as it would allow to show both
    //        the citation and bibliography examples (probably good to include some citation clusters in the example)
    return (
      <div className={'cm-Option-content'}>
        <span className={'cm-short-title'}>
          {info.shortTitle
            ? [
                match && match.shortTitle
                  ? StringExt.highlight(
                      info.shortTitle,
                      match.shortTitle.indices,
                      anonymousMark
                    )
                  : info.shortTitle,
                ': '
              ]
            : ''}
        </span>
        <span className={'cm-title'}>
          {match && match.title
            ? StringExt.highlight(
                info.title,
                match.title.indices,
                anonymousMark
              )
            : info.title}
        </span>
      </div>
    );
  }
}
