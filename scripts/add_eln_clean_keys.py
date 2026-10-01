import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MSG_DIR = ROOT / 'project.inlang' / 'messages'
LANGUAGES = ['zh', 'en', 'ja', 'ko', 'de', 'nl', 'sv']

NEW_KEYS = {
    "elnSelectionNotesTitle": {
        "zh": "选区批注表",
        "en": "Selection Notes",
        "de": "Auswahlnotizen",
        "ja": "選択範囲メモ",
        "ko": "선택 영역 메모",
        "nl": "Selectie Notities",
        "sv": "Markeringsanteckningar"
    },
    "elnNoSelectionNotes": {
        "zh": "暂无选区批注。可在序列视窗中拖动鼠标选中特定区间后，点击左侧工具栏“📝”图标添加批注。",
        "en": "No selection notes. Drag to select a range in the sequence view, then click the '📝' icon in the left toolbar to add a note.",
        "de": "Keine Auswahlnotizen. Ziehen Sie im Sequenzbereich, um eine Region auszuwählen, und klicken Sie auf das Symbol '📝', um eine Notiz hinzuzufügen.",
        "ja": "選択範囲のメモはありません。シーケンスビューで範囲を選択し、左のツールバーの「📝」アイコンをクリックしてメモを追加します。",
        "ko": "선택 영역 메모가 없습니다. 서열 뷰에서 범위를 선택한 후 왼쪽 도구 모음의 '📝' 아이콘을 클릭하여 메모를 추가하세요.",
        "nl": "Geen selectienotities. Sleep om een regio te selecteren en klik op '📝' om een notitie toe te voegen.",
        "sv": "Inga markeringsanteckningar. Dra för att välja ett område i sekvensvyn och klicka på '📝' för att lägga till."
    },
    "elnTitleLabel": {
        "zh": "记录标题",
        "en": "Record Title",
        "de": "Protokolltitel",
        "ja": "記録タイトル",
        "ko": "기록 제목",
        "nl": "Protokoltitel",
        "sv": "Protokolltitel"
    },
    "elnCategoryLabel": {
        "zh": "实验类型",
        "en": "Experiment Category",
        "de": "Experimentkategorie",
        "ja": "実験カテゴリー",
        "ko": "실험 카테고리",
        "nl": "Experiment Categorie",
        "sv": "Experimentkategori"
    },
    "elnTagsLabel": {
        "zh": "文献标签",
        "en": "Tags",
        "de": "Tags",
        "ja": "タグ",
        "ko": "태그",
        "nl": "Tags",
        "sv": "Tags"
    },
    "elnTagsPlaceholder": {
        "zh": "例如: SPICE, ELN, Auto_Sign",
        "en": "e.g., SPICE, ELN, Auto_Sign",
        "de": "z.B., SPICE, ELN, Auto_Sign",
        "ja": "例: SPICE, ELN, Auto_Sign",
        "ko": "예: SPICE, ELN, Auto_Sign",
        "nl": "bijv., SPICE, ELN, Auto_Sign",
        "sv": "t.ex., SPICE, ELN, Auto_Sign"
    },
    "elnWitnessLabel": {
        "zh": "见证复核人",
        "en": "Witness/Reviewer",
        "de": "Zeuge/Prüfer",
        "ja": "立会人/査読者",
        "ko": "입증인/검토자",
        "nl": "Getuige/Beoordelaar",
        "sv": "Vittne/Granskare"
    },
    "elnWitnessPlaceholder": {
        "zh": "输入复核人/导师姓名...",
        "en": "Enter reviewer or advisor name...",
        "de": "Geben Sie den Namen des Prüfers oder Betreuers ein...",
        "ja": "査読者または指導教員の名前を入力...",
        "ko": "검토자 또는 지도교수 이름 입력...",
        "nl": "Voer de naam van de beoordelaar of adviseur in...",
        "sv": "Ange granskare eller handledares namn..."
    },
    "elnReasonLabel": {
        "zh": "签署理由",
        "en": "Signing Reason",
        "de": "Unterzeichnungsgrund",
        "ja": "署名理由",
        "ko": "서명 이유",
        "nl": "Reden voor ondertekening",
        "sv": "Signeringsskäl"
    },
    "elnSignNotice": {
        "zh": "签署后页面将被永久锁定且不可修改，并联同当前的审计追踪日志 (Audit Trail)、质粒序列与特征元数据一并执行 SHA-256 学术数字指纹加密签名。",
        "en": "After signing, the page will be permanently locked and cannot be modified. It will be cryptographically signed with SHA-256 along with the current Audit Trail, plasmid sequence, and feature metadata.",
        "de": "Nach der Unterzeichnung wird die Seite dauerhaft gesperrt und kann nicht mehr geändert werden. Sie wird zusammen mit dem aktuellen Audit-Trail, der Plasmidsequenz und den Feature-Metadaten mit SHA-256 digital signiert.",
        "ja": "署名後、ページは永久にロックされ、変更できなくなります。現在の監査トレイル、プラスミド配列、および機能メタデータとともに、SHA-256デジタル署名されます。",
        "ko": "서명 후 페이지는 영구적으로 잠기며 수정할 수 없습니다. 현재 감사 추적, 플라스미드 서열 및 기능 메타데이터와 함께 SHA-256으로 디지털 서명됩니다.",
        "nl": "Na ondertekening wordt de pagina permanent vergrendeld en kan niet meer worden gewijzigd. Het wordt digitaal ondertekend met SHA-256 samen met de huidige audit-trail, plasmidereeks en feature-metadata.",
        "sv": "Efter signering kommer sidan att låsas permanent och kan inte ändras. Den kommer att signeras digitalt med SHA-256 tillsammans med den aktuella granskningskedjan, plasmidsekvensen och funktionsmetadata."
    },
    "elnSignButton": {
        "zh": "确认签署并归档锁定页面 (.md)",
        "en": "Sign and Lock Page Archive (.md)",
        "de": "Signieren und Seite sperren (.md)",
        "ja": "署名してページをロック (.md)",
        "ko": "서명 및 페이지 잠금 (.md)",
        "nl": "Ondertekenen en pagina vergrendelen (.md)",
        "sv": "Signera och lås sida (.md)"
    },
    "elnLockedBanner": {
        "zh": "本页面已通过 21 CFR Part 11 电子数字签名锁定",
        "en": "This page has been locked with a 21 CFR Part 11 digital signature",
        "de": "Diese Seite wurde mit einer digitalen Signatur gemäß 21 CFR Part 11 gesperrt",
        "ja": "このページは21 CFR Part 11デジタル署名でロックされています",
        "ko": "이 페이지는 21 CFR Part 11 디지털 서명으로 잠겨 있습니다",
        "nl": "Deze pagina is vergrendeld met een digitale handtekening van 21 CFR Part 11",
        "sv": "Denna sida har låsts med en digital signatur enligt 21 CFR Part 11"
    },
    "elnSignedAuthor": {
        "zh": "签署作者",
        "en": "Signed Author",
        "de": "Unterzeichnender Autor",
        "ja": "署名作成者",
        "ko": "서명 작성자",
        "nl": "Ondertekenende Auteur",
        "sv": "Undertecknad författare"
    },
    "elnSignedWitness": {
        "zh": "见证复核人",
        "en": "Witness/Reviewer",
        "de": "Zeuge/Prüfer",
        "ja": "立会人/査読者",
        "ko": "입증인/검토자",
        "nl": "Getuige/Beoordelaar",
        "sv": "Vittne/Granskare"
    },
    "elnSignedTime": {
        "zh": "签署时间",
        "en": "Signed At",
        "de": "Unterzeichnet am",
        "ja": "署名日時",
        "ko": "서명 시간",
        "nl": "Ondertekend op",
        "sv": "Signerad den"
    },
    "elnSignedReason": {
        "zh": "签署理由",
        "en": "Signing Reason",
        "de": "Unterzeichnungsgrund",
        "ja": "署名理由",
        "ko": "서명 이유",
        "nl": "Reden voor ondertekening",
        "sv": "Signeringsskäl"
    },
    "elnExportArchiveButton": {
        "zh": "导出已签署的归档记录 (.md)",
        "en": "Export Signed Archive (.md)",
        "de": "Signiertes Archiv exportieren (.md)",
        "ja": "署名済みアーカイブをエクスポート (.md)",
        "ko": "서명된 아카이브 내보내기 (.md)",
        "nl": "Gekwalificeerd archief exporteren (.md)",
        "sv": "Exportera signerat arkiv (.md)"
    },
    "elnAuditTrailLabel": {
        "zh": "21 CFR Part 11 审计追踪记录",
        "en": "21 CFR Part 11 Audit Trail",
        "de": "21 CFR Part 11 Audit-Trail",
        "ja": "21 CFR Part 11 監査トレイル",
        "ko": "21 CFR Part 11 감사 추적",
        "nl": "21 CFR Part 11 Audit-trail",
        "sv": "21 CFR Part 11 Granskningskedja"
    },
    "elnCategoryCloning": {
        "zh": "分子克隆",
        "en": "Cloning",
        "de": "Klonierung",
        "ja": "クローニング",
        "ko": "클로닝",
        "nl": "Kloneren",
        "sv": "Kloning"
    },
    "elnCategoryPcr": {
        "zh": "聚合酶链反应",
        "en": "PCR",
        "de": "PCR",
        "ja": "PCR",
        "ko": "PCR",
        "nl": "PCR",
        "sv": "PCR"
    },
    "elnCategoryTransformation": {
        "zh": "细胞转化",
        "en": "Transformation",
        "de": "Transformation",
        "ja": "形質転換",
        "ko": "형질전환",
        "nl": "Transformatie",
        "sv": "Transformation"
    },
    "elnCategoryElectrophoresis": {
        "zh": "跑胶验证",
        "en": "Electrophoresis",
        "de": "Elektrophorese",
        "ja": "電気泳動",
        "ko": "전기영동",
        "nl": "Elektrofofese",
        "sv": "Elektrofores"
    },
    "elnCategoryGeneral": {
        "zh": "通用实验",
        "en": "General",
        "de": "Allgemein",
        "ja": "一般",
        "ko": "일반",
        "nl": "Algemeen",
        "sv": "Allmänt"
    }
}

for lang in LANGUAGES:
    file_path = MSG_DIR / f"{lang}.json"
    if file_path.exists():
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        # Add new keys
        for key, lang_map in NEW_KEYS.items():
            data[key] = lang_map.get(lang, lang_map["en"])
            
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=4)
        print(f"Updated {lang}.json with new clean keys!")
