import { stringifyRule, type CompiledPrivacyPolicy } from 'rrweb-snapshot';
import type {
  elementNode,
  serializedNodeWithId,
  adoptedStyleSheetCallback,
  adoptedStyleSheetParam,
  attributeMutation,
  mutationCallBack,
} from '@rrweb/types';
import { StyleSheetMirror } from '../utils';

export class StylesheetManager {
  private trackedLinkElements: WeakSet<HTMLLinkElement> = new WeakSet();
  private mutationCb: mutationCallBack;
  private adoptedStyleSheetCb: adoptedStyleSheetCallback;
  public styleMirror = new StyleSheetMirror();

  constructor(options: {
    mutationCb: mutationCallBack;
    adoptedStyleSheetCb: adoptedStyleSheetCallback;
    // Plumbed through for later tasks; not yet consumed here.
    privacy?: CompiledPrivacyPolicy;
  }) {
    this.mutationCb = options.mutationCb;
    this.adoptedStyleSheetCb = options.adoptedStyleSheetCb;
  }

  public attachLinkElement(
    linkEl: HTMLLinkElement,
    childSn: serializedNodeWithId,
  ) {
    if ('_cssText' in (childSn as elementNode).attributes)
      this.mutationCb({
        adds: [],
        removes: [],
        texts: [],
        attributes: [
          {
            id: childSn.id,
            attributes: (childSn as elementNode)
              .attributes as attributeMutation['attributes'],
          },
        ],
      });

    this.trackLinkElement(linkEl);
  }

  public trackLinkElement(linkEl: HTMLLinkElement) {
    if (this.trackedLinkElements.has(linkEl)) return;

    this.trackedLinkElements.add(linkEl);
    this.trackStylesheetInLinkElement(linkEl);
  }

  public adoptStyleSheets(
    sheets: CSSStyleSheet[] | readonly CSSStyleSheet[],
    hostId: number,
  ) {
    if (sheets.length === 0) return;
    const adoptedStyleSheetData: adoptedStyleSheetParam = {
      id: hostId,
      styleIds: [] as number[],
    };
    const styles: NonNullable<adoptedStyleSheetParam['styles']> = [];
    for (const sheet of sheets) {
      let styleId;
      if (!this.styleMirror.has(sheet)) {
        styleId = this.styleMirror.add(sheet);
        styles.push({
          styleId,
          rules: Array.from(
            sheet.cssRules || sheet.rules || [],
            (r, index) => ({
              rule: this.maskAdoptedRule(stringifyRule(r, sheet.href)),
              index,
            }),
          ),
        });
      } else styleId = this.styleMirror.getId(sheet);
      adoptedStyleSheetData.styleIds.push(styleId);
    }
    if (styles.length > 0) adoptedStyleSheetData.styles = styles;
    this.adoptedStyleSheetCb(adoptedStyleSheetData);
  }

  public reset() {
    this.styleMirror.reset();
    this.trackedLinkElements = new WeakSet();
  }

  private maskAdoptedRule(rule: string): string {
    // Task 3 reimplements text masking against the compiled policy.
    return rule;
  }

  // TODO: take snapshot on stylesheet reload by applying event listener
  private trackStylesheetInLinkElement(_linkEl: HTMLLinkElement) {
    // linkEl.addEventListener('load', () => {
    //   // re-loaded, maybe take another snapshot?
    // });
  }
}
