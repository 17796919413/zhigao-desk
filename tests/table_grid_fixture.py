"""Synthetic source-grid responses for legacy table/library integration suites.

This adapter tests the page contract only. Actual grid runtime and connector
behavior remain covered by source_grid_browser and activity_sync_browser.
"""
def grid_data(sheets, body, title='合成审核表', revision=1):
    sheet = next((s for s in sheets if s['sheetId'] == body.get('sheetId')), sheets[0])
    values = [sheet['headers'], *sheet['rows']]
    start = body.get('startRow', 1)
    end = min(len(values), start + body.get('pageSize', 40) - 1)
    columns = [chr(65 + i) for i in range(len(sheet['headers']))]
    return {
        'title': title, 'revision': revision, 'sheetId': sheet['sheetId'],
        'token': 'synthetic-grid-token', 'startRow': start, 'endRow': end,
        'meta': {'row_count': len(values), 'column_count': len(columns)},
        'sheets': [{'sheet_id': s['sheetId'], 'title': s['name']} for s in sheets],
        'layout': {}, 'frozen': {'rows': 0, 'columns': 0},
        'ranges': [{'row_indices': list(range(start, end + 1)), 'col_indices': columns,
                    'cells': [[{'value': str(v), 'rawValue': v} for v in row]
                              for row in values[start - 1:end]]}],
    }
