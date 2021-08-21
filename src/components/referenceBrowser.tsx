import { IOption, Selector } from './selector';
import {
  CommandIDs,
  ICitableData,
  ICitableWrapper,
  ICitationContext,
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
import { paletteIcon } from '../icons';
import * as React from 'react';
import {
  CITATION_SELECTOR_CLASS,
  citationCountsLabel,
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
import { Message } from '@lumino/messaging';

const CITE_PROC_ATTRIBUTION_CLASS = 'cm-citeprocjs-cpal-attribution';

function ShowReference(props: { publication: ICitableWrapper }) {
  return (
    <div className={'cm-ReferenceDetails'}>
      <code>{JSON.stringify(props.publication, null, 4)}</code>
    </div>
  );
}

function CitationsInContext(props: {
  citations: ICitationContext[];
  excerptMaxSpan: number;
  label: string;
  clickLabel: string;
}) {
  const citations = props.citations.map(citation => {
    return (
      <li
        onClick={() => citation.host.scrollIntoView()}
        title={props.clickLabel}
      >
        {citation.excerpt.before.slice(-props.excerptMaxSpan)}
        <span dangerouslySetInnerHTML={{ __html: citation.excerpt.citation }} />
        {citation.excerpt.after.slice(0, props.excerptMaxSpan)}
      </li>
    );
  });
  return (
    <div className={'cm-CitationsInContext'}>
      <span className={'cm-CitationsInContext-label'}>{props.label}</span>
      <ul className={'cm-CitationsInContext-list'}>{citations}</ul>
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
    super({ model: citationOptionModel });
    this.placeholder = trans.__('Start typing title, author, or year');
    this.typeNames = translateTypeLabels(trans);
    this.addClass(CITATION_SELECTOR_CLASS);
    this.addClass('cm-ReferenceBrowser');
  }

  createID(option: ICitationOption): string {
    return 'c-' + (citationOptionID(option) || super.createID(option));
  }

  optionModel = citationOptionModel;

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
            icon={paletteIcon}
            execute={() =>
              this.commands.execute(CommandIDs.changeBibliographyStyle)
            }
            tooltip={this.trans.__('Change citation style')}
          />
        </div>
        {super.render()}
        <div className={CITE_PROC_ATTRIBUTION_CLASS}>
          Citation Manager extension uses <i>citeproc.js</i> which is © Frank
          Bennett; <i>citeproc-js</i> implements the{' '}
          <a href={'https://citationstyles.org/'}>Citation Style Language</a>.
        </div>
      </div>
    );
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    window.setTimeout(() => {
      const node = this.node.querySelector('.' + CITE_PROC_ATTRIBUTION_CLASS);
      if (node) {
        node.classList.add('cm-mod-hidden');
      }
      // 30 seconds should be enough
    }, 30 * 1000);
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
    const citationCounts = citationCountsLabel(
      data.citationsInDocument,
      this.trans
    );
    // TODO: only show Open in JupyterLab button if we got a link to pubmed, pubmed central and other trusted databased?
    // TODO: allow to customise proxy?
    // TODO: maybe we could fetch PDFs and XMLs and display uniformly; should ask the provider if they have a link.
    return (
      <div className={'cm-Option-content'}>
        <div className={'cm-Option-main'}>
          <CitationSource source={data.source} />
          <CitationOptionTitle
            title={publication.title}
            match={match ? match.title : null}
          />
          <span className={'cm-citationCount'} title={citationCounts}>
            {data.citationsInDocument.length !== 0
              ? '(' + data.citationsInDocument.length + ')'
              : ''}
          </span>
          <span className={'cm-year'} title={publication.date?.toUTCString()}>
            {publication.date?.getFullYear()}
          </span>
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
              tooltip={this.trans.__('Open in JupyterLab')}
            />
            <ToolbarButton
              icon={launcherIcon}
              execute={() => window.open('https://doi.org/' + publication.DOI)}
              tooltip={this.trans.__('Open in new browser window')}
            />
            <ToolbarButton
              icon={buildIcon}
              execute={() =>
                showDialog({
                  body: <ShowReference publication={publication} />,
                  buttons: [Dialog.okButton()]
                })
              }
              tooltip={this.trans.__('Show full metadata')}
            />
          </div>
          <span className={'cm-type-detail'}>{type}</span>
          <div
            className={'cm-abstract cm-collapsed'}
            onClick={event => {
              (event.target as HTMLElement).classList.remove('cm-collapsed');
            }}
          >
            {publication.abstract}
          </div>
          {data.citationsInDocument.length !== 0 ? (
            <CitationsInContext
              citations={data.citationsInDocument}
              excerptMaxSpan={50}
              label={this.trans._n(
                'Cited %1 time in this document:',
                'Cited %1 times in this document:',
                data.citationsInDocument.length
              )}
              clickLabel={this.trans.__('Click to scroll to this citation.')}
            />
          ) : null}
        </div>
      </div>
    );
  }
}
