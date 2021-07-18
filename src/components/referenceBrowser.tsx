import { IOption, Selector } from './selector';
import {
  CommandIDs,
  ICitableData,
  ICitableWrapper,
  ICitationOption
} from '../types';
import { TranslationBundle } from '@jupyterlab/translation';
import { CommandRegistry } from '@lumino/commands';
import { ToolbarButton } from './utils';
import {
  buildIcon,
  fileIcon,
  launcherIcon,
  refreshIcon
} from '@jupyterlab/ui-components';
import { bibliographyIcon } from '../icons';
import * as React from 'react';
import {
  CITATION_SELECTOR_CLASS,
  CitationOptionAuthors,
  citationOptionID,
  citationOptionModel,
  CitationOptionTitle,
  CitationSource,
  ICitationOptionMatch,
  translateTypeLabels
} from './citationSelector';
import { ReadonlyPartialJSONObject } from '@lumino/coreutils';
import { Dialog, showDialog } from '@jupyterlab/apputils';

function ShowReference(props: { publication: ICitableWrapper }) {
  return (
    <div className={'cm-ReferenceDetails'}>
      <code>{JSON.stringify(props.publication, null, 4)}</code>
    </div>
  );
}

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
            tooltip={this.trans.__('Update references')}
          />
          <ToolbarButton
            icon={bibliographyIcon}
            execute={() =>
              this.commands.execute(CommandIDs.changeBibliographyStyle)
            }
            tooltip={this.trans.__('Change citation style')}
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
    const citationCounts =
      data.citationsInDocument !== 0
        ? this.trans._n(
            '%1 occurrence',
            '%1 occurrences',
            data.citationsInDocument
          )
        : '';
    return (
      <div className={'cm-Option-content'}>
        <div className={'cm-Option-main'}>
          <CitationSource source={data.source} />
          <CitationOptionTitle
            title={publication.title}
            match={match ? match.title : null}
          />
          <span className={'cm-citationCount'} title={citationCounts}>
            {data.citationsInDocument !== 0
              ? '(' + data.citationsInDocument + ')'
              : ''}
          </span>
          <span className={'cm-year'} title={publication.date?.toUTCString()}>{publication.date?.getFullYear()}</span>
          <span className={'cm-type'}>{type}</span>
        </div>
        <div className={'cm-Option-details'}>
          <CitationOptionAuthors
            authors={publication.author}
            matches={match?.creators}
          />
        </div>
        <div className={'cm-Option-active-card'}>
          <div className={'cm-ButtonBar'}>
            <ToolbarButton
              icon={fileIcon}
              execute={() =>
                this.commands.execute(
                  CommandIDs.open,
                  publication as unknown as ReadonlyPartialJSONObject
                )
              }
              tooltip={'Open in JupyterLab'}
            />
            <ToolbarButton
              icon={launcherIcon}
              execute={() => window.open('https://doi.org/' + publication.DOI)}
              tooltip={'Open in new browser window'}
            />
            <ToolbarButton
              icon={buildIcon}
              execute={() =>
                showDialog({
                  body: <ShowReference publication={publication} />,
                  buttons: [Dialog.okButton()]
                })
              }
              tooltip={'Show full metadata'}
            />
          </div>
          <div
            className={'cm-abstract cm-collapsed'}
            onClick={event => {
              (event.target as HTMLElement).classList.remove('cm-collapsed');
            }}
          >
            {publication.abstract}
          </div>
        </div>
      </div>
    );
  }
}
