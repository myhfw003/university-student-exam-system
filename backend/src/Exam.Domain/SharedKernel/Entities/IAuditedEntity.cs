namespace Exam.Domain.SharedKernel.Entities;

/// <summary>
/// 需要自动留痕的实体标记。
/// <para>
/// 实现该接口的实体在保存时会被 EF 拦截器记录字段变更。
/// <b>只给低频、需要追溯的业务聚合实现</b>——作答流水这类高频实体不实现，
/// 否则考试高峰期的写入量会被审计日志放大。
/// </para>
/// </summary>
public interface IAuditedEntity
{
}
