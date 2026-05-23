import DOMPurify from "dompurify";
import css from "@adobe/css-tools";
import cssSelectorParser from "postcss-selector-parser";

const styleTagRegex = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

function prefixClassSelectors(selector: string): string {
    const parser = cssSelectorParser((root) => {
        root.walkClasses((className) => {
            if(className.type === 'class' && !className.value.startsWith('x-risu-')){
                className.value = 'x-risu-' + className.value;
            }
        });
    });

    return parser.processSync(selector);
}

function scopeCssRules(rules: any[], scopeSelector: string, inKeyframes = false): void {
    for(const rule of rules){
        if(rule.type === 'rule' && Array.isArray(rule.selectors) && !inKeyframes){
            rule.selectors = rule.selectors.map((selector: string) => `${scopeSelector} ${prefixClassSelectors(selector)}`);
        }
        if(Array.isArray(rule.rules)){
            const nextInKeyframes = inKeyframes || (typeof rule.name === 'string' && rule.name.includes('keyframes'));
            scopeCssRules(rule.rules, scopeSelector, nextInKeyframes);
        }
        if(rule.type === 'import'){
            rule.import = 'data:,';
        }
    }
}

export function scopeBotUiStyles(html: string, scopeSelector = '.bot-ui-overlay-scope'): string {
    return html.replace(styleTagRegex, (_full, styleText: string) => {
        try {
            const ast = css.parse(styleText);
            const rules = ast?.stylesheet?.rules;
            if(rules){
                scopeCssRules(rules, scopeSelector);
            }
            return `<style>${css.stringify(ast, {
                indent: '',
                compress: true,
            })}</style>`;
        } catch (error) {
            return '';
        }
    });
}

export function sanitizeBotUiHtml(html: string): string {
    return DOMPurify.sanitize(scopeBotUiStyles(html), {
        ADD_TAGS: ['style'],
        ADD_ATTR: ['risu-ui-action', 'risu-ui-id', 'risu-ui-value'],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
    });
}
