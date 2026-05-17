import merge from "lodash/merge";
import { languageChinese } from "./cn";
import { languageGerman } from "./de";
import { languageEnglish } from "./en";
import { languageKorean } from "./ko";
import { languageVietnamese } from "./vi";
import { languageChineseTraditional } from "./zh-Hant";
import { languageSpanish } from "./es";
import { workspaceStorageTranslations, type WorkspaceStorageLanguage, type WorkspaceStorageTranslation } from "./workspaceStorage";

type RisuLanguage = typeof languageEnglish & {
    workspaceStorage: WorkspaceStorageTranslation
}

export let language:RisuLanguage = mergeWorkspaceStorage(languageEnglish, 'en')

function mergeWorkspaceStorage(base: typeof languageEnglish, lang: WorkspaceStorageLanguage): RisuLanguage {
    return merge(safeStructuredClone(base), {
        workspaceStorage: workspaceStorageTranslations[lang]
    }) as RisuLanguage
}

export function changeLanguage(lang:string){
    if(lang === 'cn'){
        language = merge(mergeWorkspaceStorage(languageEnglish, 'cn'), languageChinese)
    }
    else if(lang === 'de'){
        language = merge(mergeWorkspaceStorage(languageEnglish, 'de'), languageGerman)
    }
    else if(lang === 'ko'){
        language = merge(mergeWorkspaceStorage(languageEnglish, 'ko'), languageKorean)
    }
    else if(lang === 'vi'){
        language = merge(mergeWorkspaceStorage(languageEnglish, 'vi'), languageVietnamese)
    }
    else if(lang === 'zh-Hant'){
        language = merge(mergeWorkspaceStorage(languageEnglish, 'zh-Hant'), languageChineseTraditional)
    }
    else if(lang === 'es'){
        language = merge(mergeWorkspaceStorage(languageEnglish, 'es'), languageSpanish)
    }
    else{
        language = mergeWorkspaceStorage(languageEnglish, 'en')
    }
}