/** Explanatory text for each column of annual income, printed as footnotes under the table (2026-09-27; it used to sit behind "?" icons). Written for people who are unfamiliar with stocks: short sentences, vernacular, no formulas.*/
export const YEAR_HELP = {
  year: '依交易日期分年。買進算在買進那年，賺賠算在賣出那年。',
  costBasis: '當年賣掉的那些股票，當初買進花了多少錢（含買進手續費）。',
  sellAmt: '當年賣出實際拿回來的錢，手續費和稅已經扣掉。',
  realized:
    '當年真正賺到或賠掉的錢，買賣的手續費和稅都算進去了。點開到逐筆賣出，可以看到不扣費用的「未含費」數字（會比實際好看一點）。',
  roi: '賺賠的錢佔當初買進成本的百分比，手續費和稅都算進去了。',
  fees: '當年付出的手續費和證交稅合計，已經算在左邊兩欄裡，不用再扣一次。逐筆賣出會拆成手續費與交易稅。',
  count: '當年買進加賣出的總筆數（買、賣各算一筆）。',
} as const
