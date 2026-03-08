<script lang="ts">
    import { changeLanguage, language } from "src/lang";
    import { DBState } from 'src/ts/stores.svelte';
    import { sleep } from "src/ts/util";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import { alertNormal, alertSelect } from "src/ts/alert";
    import { downloadFile } from "src/ts/globalApi.svelte";
    import { languageEnglish } from "src/lang/en";

    let langChanged = $state(false);
</script>

<span class="text-textcolor mt-4">{language.UiLanguage}</span>
<SelectInput className="mt-2" bind:value={DBState.db.language} onchange={async () => {
    if(DBState.db.language === 'translang'){
        const j = await alertSelect([
            'Continue Translating Existing Language',
            'Make a new language'
        ]);
        if(parseInt(j) === 0){
            const langs = [
                'de',
                'ko',
                'cn',
                'vi',
                'zh-Hant'
            ];
            const lang = parseInt(await alertSelect(langs));
            changeLanguage(langs[lang]);
            downloadFile('lang.json', new TextEncoder().encode(JSON.stringify(language, null, 4)));
            alertNormal("Downloaded JSON, translate it, and send it to the dev by discord DM and email. I will add it to the next version.");
        }
        else{
            downloadFile('lang.json', new TextEncoder().encode(JSON.stringify(languageEnglish, null, 4)));
            alertNormal("Downloaded JSON, translate it, and send it to the dev by discord DM and email. I will add it to the next version.");
        }
        DBState.db.language = 'en';
    }
    await sleep(10);
    changeLanguage(DBState.db.language);
    langChanged = true;
}}>
    <OptionInput value="de">Deutsch</OptionInput>
    <OptionInput value="en">English</OptionInput>
    <OptionInput value="ko">한국어</OptionInput>
    <OptionInput value="cn">中文</OptionInput>
    <OptionInput value="zh-Hant">中文(繁體)</OptionInput>
    <OptionInput value="vi">Tiếng Việt</OptionInput>
    <OptionInput value="translang">[Translate in your own language]</OptionInput>
</SelectInput>
{#if langChanged}
    <span class="bg-red-500 text-sm">Close the settings to take effect</span>
{/if}
