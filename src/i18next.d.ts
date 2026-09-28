import "i18next";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translations";
    // Do not type `resources` with the EN catalog. That JSON is ~1800 nested
    // keys; i18next's ParseKeys then builds a recursive template-literal union
    // that crashes tsc 5.8/5.9 ("Debug Failure. No error for last overload
    // signature"). Keys stay `string` until the catalog is split or flattened.
  }
}
