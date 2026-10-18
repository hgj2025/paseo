export function classifyModelLimit(error: string | null | undefined): "quota" | "rate" | null {
  if (!error) return null;
  if (
    /insufficient[_ ]quota|quota (?:exceeded|exhausted)|free usage exceeded|usage limit (?:reached|exceeded)|insufficient (?:credits|balance)|credit balance|额度.*(?:不足|用尽|耗尽)/i.test(
      error,
    )
  )
    return "quota";
  if (/rate[_ -]?limit|too many requests|\b429\b|限流/i.test(error)) return "rate";
  return null;
}
