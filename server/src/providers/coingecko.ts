const BASE = "https://api.coingecko.com/api/v3";

export type CryptoRow = {
  id: string;
  symbol: string;
  name: string;
  price: number;
  changePercent24h: number | null;
  marketCap: number | null;
  volume24h: number | null;
  rank: number | null;
  sparkline: number[];
};

export async function markets(perPage = 50): Promise<CryptoRow[]> {
  const url = `${BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true&price_change_percentage=24h`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const rows: any[] = await res.json();
  return rows.map((r) => ({
    id: r.id,
    symbol: (r.symbol ?? "").toUpperCase(),
    name: r.name,
    price: r.current_price,
    changePercent24h: r.price_change_percentage_24h ?? null,
    marketCap: r.market_cap ?? null,
    volume24h: r.total_volume ?? null,
    rank: r.market_cap_rank ?? null,
    sparkline: r.sparkline_in_7d?.price ?? [],
  }));
}

export async function globalStats(): Promise<{ totalMarketCap: number; btcDominance: number; ethDominance: number }> {
  const res = await fetch(`${BASE}/global`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`coingecko ${res.status}`);
  const d = (await res.json())?.data;
  return {
    totalMarketCap: d?.total_market_cap?.usd ?? 0,
    btcDominance: d?.market_cap_percentage?.btc ?? 0,
    ethDominance: d?.market_cap_percentage?.eth ?? 0,
  };
}
