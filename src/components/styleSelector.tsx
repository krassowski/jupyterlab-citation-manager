import IMatchResult = StringExt.IMatchResult;
import { IStylePreviewProvider, IStyle, IStylePreview } from '../types';
import { anonymousMark, IOption, ModalSelector } from './selector';
import { TranslationBundle } from '@jupyterlab/translation';
import { StringExt } from '@lumino/algorithm';
import * as React from 'react';
import { InfinityIfMissing } from '../utils';
import { UseSignal } from '@jupyterlab/apputils';
import { Signal } from '@lumino/signaling';

interface IStyleOption {
  style: IStyle;
}

interface IStyleOptionMatch {
  title: IMatchResult | null;
  shortTitle: IMatchResult | null;
}

function StylePreview(props: {
  preview: IStylePreview;
  maxExcerptSize: number;
}) {
  const contexts = props.preview.citations.map(citation => {
    const excerpt = citation.context.excerpt;
    return (
      <p key={'cm-preview-' + citation.citationId}>
        {excerpt.before.slice(-props.maxExcerptSize)}
        <span dangerouslySetInnerHTML={{ __html: citation.text }} />
        {excerpt.after.slice(0, props.maxExcerptSize)}
      </p>
    );
  });
  return (
    <div key={'style-preview-' + props.preview.style.id}>
      <h3>{props.preview.style.info.title}</h3>
      <div className={'cm-StylePreview-content'}>
        <div className={'cm-previewContext'}>{contexts}</div>
        <h4>Bibliography</h4>
        <div dangerouslySetInnerHTML={{ __html: props.preview.bibliography }} />
      </div>
    </div>
  );
}

const styleOptionModel = {
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
  protected previewChanged: Signal<StyleSelector, JSX.Element>;

  constructor(
    protected trans: TranslationBundle,
    protected previewProvider: IStylePreviewProvider
  ) {
    super({ model: styleOptionModel });
    this.addClass('cm-StyleSelector');
    this.previewChanged = new Signal(this);
    this.activeChanged.connect((sender, style) => {
      this.previewChanged.emit(
        <div>{this.trans.__('Loading preview...')}</div>
      );
      this.renderPreview(style).then(renderedPreview =>
        this.previewChanged.emit(renderedPreview)
      );
    });
  }

  protected async renderPreview(style: IStyleOption): Promise<JSX.Element> {
    if (!style) {
      return <div>{this.trans.__('No style selected')}</div>;
    }
    try {
      const preview = await this.previewProvider.previewStyle(style.style, 4);
      return <StylePreview preview={preview} maxExcerptSize={50} />;
    } catch (availability) {
      if (availability.reason) {
        return <div>{availability.reason}</div>;
      } else {
        return <div>{this.trans.__('Preview not available')}</div>;
      }
    }
  }

  protected getInitialOptions(): IStyleOption[] {
    return this.options.filter(style =>
      this.preferredFields.some(field =>
        style.style.info.fields.includes(field)
      )
    );
  }

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

  render(): JSX.Element {
    return (
      <div className={'cm-StyleSelector-panels'}>
        {super.render()}
        <div className={'cm-StylePreview'}>
          <UseSignal<any, JSX.Element> signal={this.previewChanged}>
            {(x, preview) => {
              return preview || null;
            }}
          </UseSignal>
        </div>
      </div>
    );
  }
}
