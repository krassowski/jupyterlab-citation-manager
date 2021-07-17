import { IOption, Selector } from './selector';
import { CommandIDs, ICitableData, ICitationOption } from '../types';
import { TranslationBundle } from '@jupyterlab/translation';
import { CommandRegistry } from '@lumino/commands';
import { ToolbarButton } from './utils';
import { refreshIcon } from '@jupyterlab/ui-components';
import { bibliographyIcon } from '../icons';
import * as React from 'react';
import {
  CITATION_SELECTOR_CLASS,
  CitationOptionAuthors,
  citationOptionID,
  citationOptionModel,
  CitationOptionTitle,
  ICitationOptionMatch,
  translateTypeLabels
} from './citationSelector';

export class ReferenceBrowser extends Selector<
  ICitationOption,
  ICitationOptionMatch
> {
  typeNames: Record<ICitableData['type'], string>;

  constructor(
    protected trans: TranslationBundle,
    protected commands: CommandRegistry
  ) {
    super();
    this.placeholder = trans.__('Start typing title, author, or year');
    this.typeNames = translateTypeLabels(trans);
    this.addClass(CITATION_SELECTOR_CLASS);
    this.addClass('cm-ReferenceBrowser');
  }

  createID(option: ICitationOption): string {
    return 'c-' + (citationOptionID(option) || super.createID(option));
  }

  optionModel = citationOptionModel;

  protected getInitialOptions(): ICitationOption[] {
    return this.options
      .filter(option => option.citationsInDocument > 0)
      .sort((a, b) => a.citationsInDocument - b.citationsInDocument);
  }

  render(): JSX.Element {
    return (
      <div className={'cm-ReferenceBrowser'}>
        <div className={'cm-ButtonBar jp-Toolbar jp-scrollbar-tiny'}>
          <ToolbarButton
            icon={refreshIcon}
            execute={() => this.commands.execute(CommandIDs.updateReferences)}
          />
          <ToolbarButton
            icon={bibliographyIcon}
            execute={() =>
              this.commands.execute(CommandIDs.changeBibliographyStyle)
            }
          />
        </div>
        {super.render()}
      </div>
    );
  }

  renderOption(props: {
    option: IOption<ICitationOption, ICitationOptionMatch>;
  }): JSX.Element {
    const data = props.option.data;
    const match = props.option.match;
    const publication = data.publication;
    const type =
      publication.type && publication.type in this.typeNames
        ? this.typeNames[publication.type]
        : publication.type;
    return (
      <div className={'cm-Option-content'}>
        <div className={'cm-Option-main'}>
          <span className={`cm-source cm-source-${data.source}`}>
            {data.source[0]}
          </span>
          <CitationOptionTitle
            title={publication.title}
            match={match ? match.title : null}
          />
          <span className={'cm-citationCount'}>
            {data.citationsInDocument !== 0
              ? this.trans._n(
                  '%1 occurrence',
                  '%1 occurrences',
                  data.citationsInDocument
                )
              : ''}
          </span>
          <span className={'cm-year'}>{publication.date?.getFullYear()}</span>
          <span className={'cm-type'}>{type}</span>
        </div>
        <div className={'cm-Option-details'}>
          <CitationOptionAuthors
            authors={publication.author}
            matches={match?.creators}
          />
        </div>
      </div>
    );
  }
}
