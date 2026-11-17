//! Which addresses the catalog is reachable on. Windows machines often have
//! several adapters (VPN, WSL, Hyper-V), so every candidate is shown with the
//! adapter's name rather than guessing one.

use std::collections::HashSet;
use std::net::IpAddr;

use serde::Serialize;

/// One reachable origin plus the Windows adapter name that owns it, e.g.
/// `Wi-Fi` or `vEthernet (WSL (Hyper-V firewall))`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanAddress {
    pub url: String,
    pub name: String,
}

pub fn lan_addresses(port: u16) -> Vec<LanAddress> {
    let mut addresses: Vec<(u8, String, std::net::Ipv4Addr)> = if_addrs::get_if_addrs()
        .map(|interfaces| {
            interfaces
                .into_iter()
                .filter_map(|interface| match interface.ip() {
                    IpAddr::V4(address)
                        if !address.is_loopback()
                            && !address.is_link_local()
                            && !address.is_unspecified() =>
                    {
                        Some((rank(address), interface.name, address))
                    }
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();

    addresses.sort_by_key(|(rank, _, address)| (*rank, *address));

    let mut seen = HashSet::new();
    addresses
        .into_iter()
        .filter(|(_, _, address)| seen.insert(*address))
        .map(|(_, name, address)| LanAddress {
            url: format!("http://{address}:{port}"),
            name,
        })
        .collect()
}

/// Home networks first; anything else stays available but further down.
fn rank(address: std::net::Ipv4Addr) -> u8 {
    let octets = address.octets();
    match octets {
        [192, 168, ..] => 0,
        [10, ..] => 1,
        [172, second, ..] if (16..=31).contains(&second) => 2,
        _ => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::rank;
    use std::net::Ipv4Addr;

    #[test]
    fn prefers_common_home_ranges() {
        assert!(rank(Ipv4Addr::new(192, 168, 1, 5)) < rank(Ipv4Addr::new(10, 0, 0, 2)));
        assert!(rank(Ipv4Addr::new(10, 0, 0, 2)) < rank(Ipv4Addr::new(172, 20, 0, 2)));
        assert!(rank(Ipv4Addr::new(172, 20, 0, 2)) < rank(Ipv4Addr::new(8, 8, 8, 8)));
    }
}
