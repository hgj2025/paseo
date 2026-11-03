/* oxlint-disable react-perf/jsx-no-new-object-as-prop, react-perf/jsx-no-new-array-as-prop, react-perf/jsx-no-new-function-as-prop -- Small paginated React Native plugin surface; styles and row handlers follow the host SDK example. */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { memoryView } from "../shared/rpc";

function chooseAvailableBank(banks, current) {
  return banks.some((item) => item.bank_id === current) ? current : (banks[0]?.bank_id ?? "");
}
function sourceLabel(item) {
  if (item.source_memory_ids?.length)
    return item.source_memory_ids.length + " 条来源证据 · 查看详情";
  return item.document_id ? "已关联原始记录 · 查看详情" : "查看详情";
}

const names = { world: "事实", experience: "经历", observation: "整合经验" };
const date = (value) => (value ? new Date(value).toLocaleString("zh-CN") : "未记录");

// oxlint-disable-next-line complexity -- This screen renders independent loading, empty, error, list and detail states.
export function MemoryPage({ theme, host, navigation }) {
  const call = useRpc(memoryView);
  const [banks, setBanks] = useState([]),
    [bankTotal, setBankTotal] = useState(0),
    [bankOffset, setBankOffset] = useState(0);
  const [bank, setBank] = useState("");
  const [draft, setDraft] = useState(""),
    [query, setQuery] = useState(""),
    [type, setType] = useState("");
  const [offset, setOffset] = useState(0),
    [page, setPage] = useState(null),
    [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [detailBusy, setDetailBusy] = useState(false),
    [detailError, setDetailError] = useState("");
  const listVersion = useRef(0),
    detailVersion = useRef(0);
  const c = theme.colors;
  const text = { color: c.foreground, fontSize: 14, lineHeight: 22 };
  const muted = { color: c.foregroundMuted, fontSize: 12, lineHeight: 20 };
  const button = {
    paddingHorizontal: 10,
    paddingVertical: 5,
    minHeight: 30,
    borderRadius: 6,
    backgroundColor: c.surface1,
  };
  const row = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    flexWrap: "wrap" as const,
  };
  useEffect(() => {
    let live = true;
    call({ action: "banks", offset: bankOffset })
      .then((result) => {
        if (!live) return;
        setBanks(result.data.banks ?? []);
        setBankTotal(result.data.total ?? 0);
        setBank((current) => chooseAvailableBank(result.data.banks ?? [], current));
        return undefined;
      })
      .catch((failure) => live && setError(failure.message));
    return () => {
      live = false;
    };
  }, [call, host.id, bankOffset, refresh]);
  useEffect(() => {
    const version = ++listVersion.current;
    detailVersion.current++;
    setDetail(null);
    setDetailBusy(false);
    setDetailError("");
    if (!bank) {
      setPage(null);
      return;
    }
    setBusy(true);
    setError("");
    setPage(null);
    call({ action: "list", bank, offset, query, ...(type ? { type } : {}) })
      .then((result) => {
        if (version === listVersion.current) setPage(result.data);
        return undefined;
      })
      .catch((failure) => version === listVersion.current && setError(failure.message))
      .finally(() => version === listVersion.current && setBusy(false));
    return () => {
      if (version === listVersion.current) listVersion.current = version + 1;
    };
  }, [call, bank, type, query, offset, refresh]);
  const openDetail = useCallback(
    async (item) => {
      const version = ++detailVersion.current;
      setDetail(item);
      setDetailBusy(true);
      setDetailError("");
      try {
        const result = await call({ action: "detail", bank, id: item.id });
        if (version === detailVersion.current) setDetail(result.data.memory ?? result.data);
      } catch (failure) {
        if (version === detailVersion.current) setDetailError(failure.message);
      } finally {
        if (version === detailVersion.current) setDetailBusy(false);
      }
    },
    [call, bank],
  );
  const chooseBank = (value) => {
    setOffset(0);
    setBank(value);
  };
  const applySearch = () => {
    setOffset(0);
    setQuery(draft.trim());
  };
  const count = page?.stats?.nodes_by_fact_type ?? {};
  const action = (label, onPress, disabled = false) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[button, disabled && { opacity: 0.45 }]}
    >
      <Text style={text}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingTop: 10,
          paddingBottom: 10,
          gap: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
        }}
      >
        {bankTotal > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            {banks.map((item) => (
              <Pressable
                key={item.bank_id}
                accessibilityRole="button"
                accessibilityState={{ selected: bank === item.bank_id }}
                onPress={() => chooseBank(item.bank_id)}
                style={[button, bank === item.bank_id && { backgroundColor: c.surface2 }]}
              >
                <Text
                  style={{
                    ...text,
                    color: c.foreground,
                  }}
                >
                  {item.name || item.bank_id}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        )}
        {bankTotal > 100 && (
          <View style={row}>
            {action(
              "上一组项目",
              () => setBankOffset((value) => Math.max(0, value - 100)),
              bankOffset === 0,
            )}
            <Text style={muted}>共 {bankTotal} 个项目</Text>
            {action(
              "下一组项目",
              () => setBankOffset((value) => value + 100),
              bankOffset + 100 >= bankTotal,
            )}
          </View>
        )}
        <View style={row}>
          <TextInput
            accessibilityLabel="搜索当前项目的记忆"
            placeholder="搜索记忆…"
            placeholderTextColor={c.foregroundMuted}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={applySearch}
            style={{
              ...text,
              flex: 1,
              minWidth: 160,
              minHeight: 32,
              paddingHorizontal: 10,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 6,
            }}
          />
          {action("搜索", applySearch, !bank)}
          {action("刷新", () => setRefresh((value) => value + 1))}
        </View>
        <View style={row}>
          {[
            ["", "全部"],
            ["observation", "整合经验"],
            ["world", "事实"],
            ["experience", "经历"],
          ].map(([value, label]) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: type === value }}
              onPress={() => {
                setOffset(0);
                setType(value);
              }}
              style={[
                button,
                {
                  backgroundColor: type === value ? c.surface2 : "transparent",
                  paddingHorizontal: 9,
                  paddingVertical: 4,
                  minHeight: 28,
                },
              ]}
            >
              <Text style={text}>
                {label}
                {page &&
                page.total > 30 &&
                (value ? (count[value] ?? 0) : page.stats.total_nodes) > 0
                  ? " " + (value ? count[value] : page.stats.total_nodes)
                  : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, gap: 0 }}>
        {error ? (
          <Text accessibilityRole="alert" style={{ ...text, color: c.statusDanger }}>
            {error}
          </Text>
        ) : null}
        {busy ? (
          <View style={row}>
            <ActivityIndicator color={c.foregroundMuted} />
            <Text style={muted}>正在读取记忆…</Text>
          </View>
        ) : null}
        {!busy && !error && !bank ? (
          <Text style={text}>还没有项目记忆库。保存记忆后可在这里查看。</Text>
        ) : null}
        {!busy && page?.items?.length === 0 ? (
          <Text style={text}>
            {query ? "没有找到匹配的记忆，试试其他关键词。" : "当前分类还没有记忆。"}
          </Text>
        ) : null}
        {page?.items?.map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={"查看记忆：" + item.text}
            key={item.id}
            onPress={() => openDetail(item)}
            style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border }}
          >
            <Text style={muted}>
              {names[item.fact_type] ?? item.fact_type} · {date(item.updated_at ?? item.date)}
              {item.state && item.state !== "valid" ? " · " + item.state : ""}
            </Text>
            <Text numberOfLines={3} style={{ ...text, marginTop: 4 }}>
              {item.text}
            </Text>
            <Text style={muted}>{sourceLabel(item)}</Text>
          </Pressable>
        ))}
        {page && page.total > 30 && (
          <View style={{ ...row, justifyContent: "space-between", paddingVertical: 16 }}>
            <Text style={muted}>
              {page.total
                ? `${offset + 1}–${Math.min(offset + 30, page.total)} / ${page.total} 条`
                : "0 条"}
            </Text>
            <View style={row}>
              {action("上一页", () => setOffset((value) => Math.max(0, value - 30)), offset === 0)}
              {action("下一页", () => setOffset((value) => value + 30), offset + 30 >= page.total)}
            </View>
          </View>
        )}
        {detail && (
          <View
            style={{
              marginTop: 12,
              padding: 16,
              gap: 10,
              borderWidth: 1,
              borderColor: c.border,
              borderRadius: 8,
            }}
          >
            <View style={{ ...row, justifyContent: "space-between" }}>
              <Text style={text}>记忆详情</Text>
              {action("收起详情", () => {
                detailVersion.current++;
                setDetail(null);
              })}
            </View>
            {detailBusy && <Text style={muted}>正在读取来源…</Text>}
            {detailError && <Text style={{ ...muted, color: c.statusDanger }}>{detailError}</Text>}
            <Text selectable style={text}>
              {detail.text}
            </Text>
            <Text selectable style={muted}>
              ID：{detail.id}
            </Text>
            {detail.context ? (
              <Text selectable style={muted}>
                上下文：{detail.context}
              </Text>
            ) : null}
            <Text style={muted}>
              更新：{date(detail.updated_at ?? detail.date)} · 状态：{detail.state ?? "未记录"}
            </Text>
            {detail.metadata && Object.keys(detail.metadata).length > 0 && (
              <Text selectable style={muted}>
                来源元数据：{JSON.stringify(detail.metadata, null, 2)}
              </Text>
            )}
            {detail.document_id && (
              <Text selectable style={muted}>
                原始记录：{detail.document_id}
              </Text>
            )}
            {detail.source_memory_ids?.map((id) =>
              action("查看来源 " + id.slice(0, 8), () => openDetail({ id, text: "正在读取来源…" })),
            )}
            {detail.metadata?.agent_id && navigation?.openAgent
              ? action("打开来源会话", () =>
                  navigation.openAgent({ agentId: detail.metadata.agent_id, serverId: host.id }),
                )
              : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
