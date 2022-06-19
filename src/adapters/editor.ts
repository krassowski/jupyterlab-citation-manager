import { IDocumentWidget } from '@jupyterlab/docregistry';
import { FileEditor } from '@jupyterlab/fileeditor';
import { CodeEditor } from '@jupyterlab/codeeditor';

import {
  CitationInsertData,
  CitationQuerySubset,
  CiteProc,
  ICitableItemRecordsBySource,
  ICitation,
  ICitationFormattingOptions,
  IDocumentAdapter
} from '../types';
import OutputMode = CiteProc.OutputMode;
import { HTMLFormatter, TexFormatter, IOutputFormatter } from '../formatting';


function editorContentSubset(editor: CodeEditor.IEditor, subset: CitationQuerySubset): string {
  const cursor = editor.getCursorPosition();
  const offset = editor.getOffsetAt(cursor);
  const content = editor.model.value.text;
  switch (subset) {
    case 'all':
      return content;
    case 'after-cursor':
      return content.substring(offset);
    case 'before-cursor':
      return content.substring(0, offset);
  }
}

export class EditorAdapter implements
  IDocumentAdapter<IDocumentWidget<FileEditor>>
{
  citations: ICitation[];

  constructor(
    public document: IDocumentWidget<FileEditor>,
    public options: ICitationFormattingOptions
  ) {
    this.citations = [];
  }

  getCitableItemsFallbackData(): ICitableItemRecordsBySource | null {
    // currently not supported for editors
    return null;
  }

  setCitableItemsFallbackData(data: ICitableItemRecordsBySource): void {
    // currently not supported for editors
  }

  isAvailable(): boolean {
    return this.outputFormat === 'latex';
  }

  private insertAtCursor(text: string) {
    const fileEditor = this.document.content;
    if (fileEditor) {
      const editor = fileEditor.editor;
      const cursor = editor.getCursorPosition();
      const offset = editor.getOffsetAt(cursor);
      fileEditor.model.value.insert(offset, text);
      const updatedPosition = editor.getPositionAt(offset + text.length);
      if (updatedPosition) {
        editor.setCursorPosition(updatedPosition);
      }
    }
  }

  get outputFormat(): OutputMode {
    // TODO: app.docRegistry.getFileTypeForModel(contentsModel)
    const codeMirrorMimeType = this.document.content.model.mimeType;
    if (codeMirrorMimeType === 'text/html') {
      return 'html';
    } else if (['text/x-latex', 'text/x-tex'].includes(codeMirrorMimeType)) {
      return 'latex';
    } else {
      return this.options.defaultFormat;
    }
  }

  getCitationStyle(): string | undefined {
    // TODO
    return;
  }

  setCitationStyle(newStyle: string): void {
    // TODO - as metadata in frontmatter for Markdown?
    return;
  }

  protected get formatter(): IOutputFormatter {
    if (this.outputFormat === 'latex') {
      return new TexFormatter(this.options);
    }
    return new HTMLFormatter(this.options);
  }

  insertBibliography(bibliography: string): void {
    this.insertAtCursor(this.formatBibliography(bibliography));
  }

  formatBibliography(bibliography: string): string {
    return this.formatter.formatBibliography(bibliography);
  }

  updateBibliography(bibliography: string): void {
    const newText = this.formatter.updateBibliography(
      this.document.content.model.value.text,
      bibliography
    );
    if (newText != null) {
      this.document.content.model.value.text = newText;
    }
  }

  formatCitation(citation: CitationInsertData): string {
    return this.formatter.formatCitation(citation);
  }

  insertCitation(citation: CitationInsertData): void {
    this.insertAtCursor(this.formatCitation(citation));
    // TODO: maybe store current citations in metadata (how?)
  }

  updateCitation(citation: ICitation): void {
    const oldText = this.document.content.model.value.text;
    const { newText, matchesCount } = this.formatter.updateCitation(
      oldText,
      citation
    )
    if (newText != null) {
      this.document.content.model.value.text = newText;
    }
    if (matchesCount === 0) {
      console.warn('Failed to update citation', citation, '- no matches found');
    } else if (matchesCount > 1) {
      console.warn(
        'Citation',
        citation,
        'appears in more than once with the same ID; please correct it manually'
      );
    }
  }

  findCitations(subset: CitationQuerySubset): ICitation[] {

    const fileEditor = this.document.content;
    if (!fileEditor) {
      throw Error('Editor not available')
    }
    const editor = fileEditor.editor;
    return this.formatter.extractCitations(
      editorContentSubset(editor, subset),
      {
        host: this.document.content.node
      },
      {}
    );
  }
}