import type { Element, Root as HastRoot } from 'hast';
import type { Root as MdastRoot, RootContent } from 'mdast';

const random = () => (globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Date.now()}`).replace(/[^a-z0-9]/gi, '');

/**
 * How the app's own marks on a reply's elements (the alerts' `data-alert`, Skim's faded sentences) get past the sanitiser
 * without raw HTML being able to forge them. The marks are made before it (`remarkAlerts`, `remarkSkimFade`), and it strips
 * anything it doesn't know, so they go through as one attribute whose value starts with `SEAL`, a random string made when the
 * app starts that no reply can know. `rehypeUnseal`, after the sanitiser, turns each into the real marks. A `class="text-faint"`,
 * `data-alert` or `data-skim-faded` written in the reply's own HTML is not in the schema, so it is dropped.
 *
 * Footnote ids work the same way: remark-rehype is told to prefix them with `FOOTNOTE_PREFIX`, which holds a random string of its own (the seal itself never reaches the page), and the
 * schema keeps only ids that start with it.
 */
export const SEAL = random();

/**
 * The footnotes' heading has an `id` the notes' links name (`aria-describedby`); remark-rehype sets it after these properties, so
 * the sanitiser drops it, and the seal gives it back (`rehypeUnseal`).
 */
export const FOOTNOTE_LABEL_PROPERTIES = { className: ['sr-only'], dataSeal: `${SEAL}:footnote-label` };

/** What remark-rehype puts before a footnote's ids and links (`clobberPrefix`): a random string of its own, since it stays in the page. */
export const FOOTNOTE_PREFIX = `user-content-${random()}-`;

/** The sealed marks, as the attribute `data-seal` holds them. */
const MARKS = {
  alertTitle: `${SEAL}:alert-title`,
  skim: `${SEAL}:skim`,
  barePath: `${SEAL}:bare-path`,
  alert: (kind: string) => `${SEAL}:alert:${kind}`,
};

const ALERT_KINDS = /^(?:note|tip|important|warning|caution)$/;

/** Replaces the marks the alert, Skim and bare path plugins put on the tree with sealed ones. Runs after them. */
export function remarkSeal() {
  const walk = (node: RootContent | MdastRoot) => {
    const properties = node.data && 'hProperties' in node.data ? (node.data.hProperties as Record<string, unknown> | undefined) : undefined;
    if (properties) {
      if (typeof properties.dataAlert === 'string' && ALERT_KINDS.test(properties.dataAlert)) node.data!.hProperties = { dataSeal: MARKS.alert(properties.dataAlert) };
      else if ('dataAlertTitle' in properties) node.data!.hProperties = { dataSeal: MARKS.alertTitle };
      else if ('dataSkimFaded' in properties) node.data!.hProperties = { dataSeal: MARKS.skim };
      else if ('dataBarePath' in properties) node.data!.hProperties = { dataSeal: MARKS.barePath };
    }
    if ('children' in node) for (const child of node.children as RootContent[]) walk(child);
  };
  return (tree: MdastRoot) => walk(tree);
}

/** Turns the sealed marks into the real ones, after the sanitiser has dropped whatever else a reply's HTML set. */
export function rehypeUnseal() {
  const walk = (node: HastRoot | Element) => {
    if (node.type === 'element') {
      const seal = node.properties.dataSeal;
      if (typeof seal === 'string' && seal.startsWith(`${SEAL}:`)) {
        delete node.properties.dataSeal;
        const mark = seal.slice(SEAL.length + 1);
        if (mark === 'skim') Object.assign(node.properties, { className: ['text-faint'], dataSkimFaded: true });
        else if (mark === 'bare-path') node.properties.dataBarePath = '';
        else if (mark === 'footnote-label') node.properties.id = 'footnote-label';
        else if (mark === 'alert-title') node.properties.dataAlertTitle = '';
        else if (mark.startsWith('alert:')) node.properties.dataAlert = mark.slice('alert:'.length);
      } else if ('dataSeal' in node.properties) {
        delete node.properties.dataSeal;
      }
    }
    for (const child of node.children) if (child.type === 'element') walk(child);
  };
  return (tree: HastRoot) => walk(tree);
}
