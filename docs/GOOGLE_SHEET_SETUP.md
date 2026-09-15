# 3.1 試算表結構

請先建立獨立測試試算表，共用維持「限制」。填入 GAS 的 SPREADSHEET_ID 後，手動執行 setupDatabase 自動建立下列工作表，不必先填虛構学生或空作業來表示班級存在。

| 工作表      | 依序欄位                                                             | 唯一性           |
| ----------- | -------------------------------------------------------------------- | ---------------- |
| years       | year                                                                 | 年度             |
| classes     | year, class_name                                                     | 年度＋班級       |
| subjects    | year, class_name, subject                                            | 年度＋班級＋科目 |
| students    | year, class_name, seat_num, name                                     | 年度＋班級＋座號 |
| assignments | assignment_id, year, class_name, subject, unit                       | assignment_id    |
| records     | assignment_id, year, class_name, seat_num, status, score, note, date | 作業ID＋座號     |
| \_backups   | backup_id, created_at, action, part, json                            | 備份ID＋分段序號 |

year、ID 與座號於 API 邊界統一為字串；座號1～999，個位數補零。status 是空字串／submitted／late／missing／exempt。score 是0～100或空值；缺交為0、免交與未登記為空值。「免交」不能當數字。date 為 YYYY-MM-DD 或空值。

表格應是純資料。標題不可更名，不能加入未知欄位或公式；另開工作表做分析，不直接改應用資料表。學生name欄填「代稱」，例如學生A；CSV範例：

```csv
座號,代稱
01,學生A
02,學生B
03,學生C
```

CSV 支援欄位順序交換與標準引號，但不會把學號自動當座號。每班最多200人；檔案最多1MB；請先轉為UTF-8。

V3.0 既有三表也必須先完整複製後才執行初始化。records 增加第8欄date；舊表未保存日期，因此遷移後保持空白。已有歷史分數的班級不允許匯入時把原座號移除／換給另一人；請建立新班級，或使用明確刪除（會連同相關紀錄移除並備份）的流程。

復原請看 [GAS設定與復原](GAS_SETUP.md)。本版以保守限制保護座號關聯，尚未建立跨班級穩定student_id。
