"""Synthetic Office fixtures; only opens owned files in private COM instances."""
from pathlib import Path
import datetime
import hashlib
import json
import zipfile
import fitz
import win32com.client
from PIL import Image, ImageDraw
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.drawing.image import Image as SheetImage


def create_fixtures(out):
    image = out / 'synthetic-blue.png'
    bitmap = Image.new('RGB', (240, 120), '#0055AA')
    ImageDraw.Draw(bitmap).rectangle((60, 30, 180, 90), fill='white')
    bitmap.save(image)
    word = out / 'original.docx'
    doc = Document()
    doc.sections[0].header.paragraphs[0].text = '合成品牌 · 页眉保留'
    doc.sections[0].footer.paragraphs[0].text = '内部验收夹具 · 页脚保留'
    doc.add_heading('星河杯 · 复杂格式验收', 0)
    run = doc.add_paragraph().add_run('星河杯容量为500毫升。蓝色加粗原文保留。')
    run.font.color.rgb = RGBColor.from_string('0055AA')
    run.font.bold = True
    run.font.size = Pt(13)
    table = doc.add_table(rows=2, cols=2)
    table.style = 'Table Grid'
    table.cell(0, 0).text = '参数'
    table.cell(0, 1).text = '说明'
    table.cell(1, 0).text = '容量'
    table.cell(1, 1).text = '500毫升'
    link = OxmlElement('w:hyperlink')
    link.set(qn('w:anchor'), 'synthetic-anchor')
    r = OxmlElement('w:r')
    t = OxmlElement('w:t')
    t.text = '内部链接：500毫升仅作不可改写保护测试'
    r.append(t)
    link.append(r)
    doc.add_paragraph()._p.append(link)
    doc.add_picture(str(image), width=Inches(2.4))
    doc.add_page_break()
    doc.add_heading('第二页：保留项目', 1)
    doc.add_paragraph('编号 7、原有绿色文字与图片不修改。')
    doc.paragraphs[-1].runs[0].font.color.rgb = RGBColor.from_string('008040')
    doc.save(word)

    excel = out / 'original.xlsx'
    book = Workbook()
    sheet = book.active
    sheet.title = '参数'
    sheet.merge_cells('A1:D1')
    sheet['A1'] = '星河杯 · 合成验收'
    sheet['A1'].fill = PatternFill('solid', fgColor='DDEBFA')
    sheet['A1'].alignment = Alignment(horizontal='center')
    sheet['A2'] = '容量为500毫升，保留蓝色加粗格式。'
    sheet['A2'].font = Font(name='等线', size=12, color='0055AA', bold=True)
    sheet['A2'].alignment = Alignment(wrap_text=True)
    sheet['B2'] = 7
    sheet['C2'] = '=B2+1'
    sheet['D2'] = True
    sheet['A3'] = datetime.datetime(2026, 11, 16)
    sheet['A3'].number_format = 'yyyy-mm-dd'
    sheet['A4'] = '保留链接'
    sheet['A4'].hyperlink = '#参数!A1'
    sheet.column_dimensions['A'].width = 44
    for name in ['B', 'C', 'D']:
        sheet.column_dimensions[name].width = 15
    sheet.row_dimensions[2].height = 40
    sheet.freeze_panes = 'B2'
    sheet.print_area = 'A1:D11'
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = 'landscape'
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 1
    sheet.add_image(SheetImage(str(image)), 'A6')
    second = book.create_sheet('保留表')
    second['A1'] = '跨表数据不修改'
    second['B1'] = 29
    book.save(excel)
    # Excel supplies genuine cached formula values before the browser reads the file.
    app = win32com.client.DispatchEx('Excel.Application')
    app.Visible = False
    app.DisplayAlerts = False
    app.AutomationSecurity = 3
    try:
        workbook = app.Workbooks.Open(str(excel), UpdateLinks=0)
        try:
            app.CalculateFull()
            workbook.Save()
        finally:
            workbook.Close(False)
    finally:
        app.Quit()
    return word, excel


def protected_parts(before, after, allowed):
    with zipfile.ZipFile(before) as left, zipfile.ZipFile(after) as right:
        left_files={i.filename for i in left.infolist() if not i.is_dir()}
        right_files={i.filename for i in right.infolist() if not i.is_dir()}
        assert left_files == right_files, 'Package members changed'
        preserved = []
        for name in sorted(left_files):
            if allowed(name):
                continue
            assert left.read(name) == right.read(name), name
            preserved.append(name)
        return preserved


def word_record(app, path, pdf):
    doc = app.Documents.Open(str(path), ReadOnly=True, AddToRecentFiles=False,
                             ConfirmConversions=False, OpenAndRepair=False)
    try:
        text = doc.Content.Text
        at = text.index('容量为') + len('容量为')
        # Word Range offsets count UTF-16 characters; these fixtures use only BMP text.
        characters = [doc.Range(at+i, at+i+1) for i in range(3)]
        record = {'text': text, 'tables': doc.Tables.Count,
                  'images': doc.InlineShapes.Count, 'links': doc.Hyperlinks.Count,
                  'pages': doc.ComputeStatistics(2),
                  'colors': [r.Font.Color for r in characters],
                  'bold': [r.Font.Bold for r in characters],
                  'header': doc.Sections(1).Headers(1).Range.Text,
                  'footer': doc.Sections(1).Footers(1).Range.Text}
        doc.ExportAsFixedFormat(str(pdf), 17)
        return record
    finally:
        doc.Close(False)


def excel_record(app, path, pdf):
    book = app.Workbooks.Open(str(path), UpdateLinks=0, ReadOnly=True)
    try:
        sheet = book.Worksheets('参数')
        cell = sheet.Range('A2')
        at = cell.Value.index('500' if '500' in cell.Value else '300') + 1
        chars = [cell.GetCharacters(at+i, 1) for i in range(3)]
        record = {'text': cell.Value, 'number': sheet.Range('B2').Value2,
                  'formula': sheet.Range('C2').Formula, 'formulaValue': sheet.Range('C2').Value2,
                  'boolean': sheet.Range('D2').Value, 'date': sheet.Range('A3').Value2,
                  'dateFormat': sheet.Range('A3').NumberFormat,
                  'merge': sheet.Range('A1').MergeArea.Address,
                  'colors': [c.Font.Color for c in chars], 'bold': [c.Font.Bold for c in chars],
                  'images': sheet.Shapes.Count, 'links': sheet.Hyperlinks.Count,
                  'width': sheet.Columns('A').ColumnWidth, 'height': sheet.Rows(2).RowHeight,
                  'sheets': book.Sheets.Count, 'otherValue': book.Sheets('保留表').Range('B1').Value2}
        sheet.ExportAsFixedFormat(0, str(pdf))
        return record
    finally:
        book.Close(False)


def verify_native(out):
    preserved_word = protected_parts(out/'original.docx', out/'modified.docx', lambda n: n=='word/document.xml')
    preserved_excel = protected_parts(out/'original.xlsx', out/'modified.xlsx', lambda n: n.startswith('xl/worksheets/sheet') and n.endswith('.xml'))
    word = win32com.client.DispatchEx('Word.Application')
    word.Visible = False
    word.DisplayAlerts = 0
    word.AutomationSecurity = 3
    try:
        version_word = word.Version
        before_word = word_record(word, out/'original.docx', out/'word-before.pdf')
        after_word = word_record(word, out/'modified.docx', out/'word-after.pdf')
    finally:
        word.Quit()
    assert '容量为300毫升' in after_word['text'] and '300毫升\r' in after_word['text']
    assert '内部链接：500毫升' in after_word['text'], 'Locked hyperlink must be unchanged'
    for key in ['tables','images','links','pages','header','footer','bold']:
        assert before_word[key] == after_word[key], key
    assert after_word['colors'] == [255, before_word['colors'][1], before_word['colors'][2]], after_word

    excel = win32com.client.DispatchEx('Excel.Application')
    excel.Visible = False
    excel.DisplayAlerts = False
    excel.AutomationSecurity = 3
    try:
        version_excel = excel.Version
        before_excel = excel_record(excel, out/'original.xlsx', out/'excel-before.pdf')
        after_excel = excel_record(excel, out/'modified.xlsx', out/'excel-after.pdf')
    finally:
        excel.Quit()
    assert '300毫升' in after_excel['text']
    for key in before_excel.keys() - {'text','colors'}:
        assert before_excel[key] == after_excel[key], (key,before_excel[key],after_excel[key])
    assert after_excel['colors'] == [255, before_excel['colors'][1], before_excel['colors'][2]], after_excel
    assert after_excel['formulaValue'] == 8 and after_excel['sheets'] == 2
    renders = []
    for pdf in ['word-before','word-after','excel-before','excel-after']:
        with fitz.open(out/(pdf+'.pdf')) as document:
            for i, page in enumerate(document):
                path = out/f'{pdf}-{i+1}.png'
                page.get_pixmap(matrix=fitz.Matrix(1.3,1.3)).save(path)
                renders.append(str(path))
    record = {'wordVersion':version_word,'excelVersion':version_excel,
              'word':{'before':before_word,'after':after_word,'protectedParts':preserved_word},
              'excel':{'before':before_excel,'after':after_excel,'protectedParts':preserved_excel},
              'renders':renders,'hashes':{name:hashlib.sha256((out/name).read_bytes()).hexdigest()
                  for name in ['original.docx','original.xlsx','modified.docx','modified.xlsx']}}
    (out/'native-verification.json').write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8')
    return record
