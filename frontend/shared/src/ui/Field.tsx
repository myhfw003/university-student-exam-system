/* ==========================================================================
   知行测评 · 表单原语
   --------------------------------------------------------------------------
   类名沿用原型 .field / .field-label / .field-req / .field-hint / .field-error
   与 .input / .select-wrap / .select / .textarea。

   无障碍约定（docs/development/02-conventions.md §3.4）：
   - 错误用 aria-invalid + aria-describedby 指向错误文本；
   - 必填用 .field-req 标记并写入 label 文案；
   - 每个控件都有可编程识别的名称（label 或 aria-label）。
   ========================================================================== */

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

/** Field 容器属性。 */
export interface FieldProps {
  /** 标签文案。 */
  label: ReactNode;
  /**
   * 关联控件的 id。
   *
   * 传入后 label 的 `for` 指向该控件，屏幕阅读器与「点击标签聚焦控件」
   * 都能正确工作（docs/development/02-conventions.md §3.4）。
   */
  htmlFor?: string;
  /** 是否必填。 */
  required?: boolean;
  /** 辅助说明。 */
  hint?: ReactNode;
  /** 错误文案。 */
  error?: ReactNode;
  /** 控件。 */
  children: ReactNode;
  /** 额外类名。 */
  className?: string;
}

/** 表单字段容器：标签 + 必填标记 + 提示 + 错误。 */
export function Field({ label, required, hint, error, children, className, htmlFor }: FieldProps) {
  const classes = ["field", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="field-req" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? <div className="field-hint">{hint}</div> : null}
      {error ? <div className="field-error">{error}</div> : null}
    </div>
  );
}

/** 输入框属性。 */
export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  /** 是否必填（影响 aria-required 与错误展示）。 */
  invalid?: boolean;
  /** 错误文案，传入后自动建立 aria-describedby 关联。 */
  errorText?: string;
  /** 辅助说明。 */
  hint?: string;
  /** 额外类名。 */
  className?: string;
}

/** 文本输入框。 */
export function TextInput({
  invalid,
  errorText,
  hint,
  className,
  ...rest
}: TextInputProps) {
  const hintId = useId();
  const errorId = useId();
  const describedBy =
    [hint ? hintId : null, errorText ? errorId : null].filter(Boolean).join(" ") || undefined;

  const classes = ["input", className].filter(Boolean).join(" ");

  return (
    <>
      <input
        {...rest}
        className={classes}
        aria-invalid={invalid || errorText ? true : undefined}
        aria-describedby={describedBy}
        aria-required={rest.required || undefined}
      />
      {hint ? (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {errorText ? (
        <div className="field-error" id={errorId}>
          {errorText}
        </div>
      ) : null}
    </>
  );
}

/** 下拉选择属性。 */
export interface SelectInputProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className"> {
  /** 错误文案。 */
  errorText?: string;
  /** 辅助说明。 */
  hint?: string;
  /** 额外类名。 */
  className?: string;
}

/** 下拉选择框。 */
export function SelectInput({ errorText, hint, className, children, ...rest }: SelectInputProps) {
  const hintId = useId();
  const errorId = useId();
  const describedBy =
    [hint ? hintId : null, errorText ? errorId : null].filter(Boolean).join(" ") || undefined;

  const classes = ["input", "select", className].filter(Boolean).join(" ");

  return (
    <>
      <span className="select-wrap">
        <select
          {...rest}
          className={classes}
          aria-invalid={errorText ? true : undefined}
          aria-describedby={describedBy}
        >
          {children}
        </select>
      </span>
      {hint ? (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {errorText ? (
        <div className="field-error" id={errorId}>
          {errorText}
        </div>
      ) : null}
    </>
  );
}

/** 多行文本属性。 */
export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  /** 错误文案。 */
  errorText?: string;
  /** 辅助说明。 */
  hint?: string;
  /** 额外类名。 */
  className?: string;
}

/** 多行文本框。 */
export function TextArea({ errorText, hint, className, ...rest }: TextAreaProps) {
  const hintId = useId();
  const errorId = useId();
  const describedBy =
    [hint ? hintId : null, errorText ? errorId : null].filter(Boolean).join(" ") || undefined;

  const classes = ["textarea", className].filter(Boolean).join(" ");

  return (
    <>
      <textarea
        {...rest}
        className={classes}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <div className="field-hint" id={hintId}>
          {hint}
        </div>
      ) : null}
      {errorText ? (
        <div className="field-error" id={errorId}>
          {errorText}
        </div>
      ) : null}
    </>
  );
}
