/**
 * 页面主世界的注入入口：拆掉可见性闸门（关闭置顶窗口时注入）。
 * 与 gateOn 成对，原因见那边的注释。
 */
import { sepWinEventGate } from '../../core/gate';

sepWinEventGate(false);
