//! The OPDS 1.2 acquisition feed. Pure string building over a snapshot, so it
//! can be tested without a listener.

use std::fmt::Write as _;

use serde::Deserialize;

use super::ShareBook;

/// KOReader paginates comfortably at this size, and the whole feed is small.
pub const PAGE_SIZE: usize = 50;

const EPOCH: &str = "1970-01-01T00:00:00Z";

#[derive(Debug, Default, Deserialize)]
pub struct FeedQuery {
    pub page: Option<usize>,
    pub q: Option<String>,
}

/// One page of the catalog. `origin` is `http://host:port` taken from the
/// request, so links work whichever interface the reader used; an empty origin
/// keeps the hrefs relative.
pub fn render_feed(books: &[ShareBook], origin: &str, page: usize, query: Option<&str>) -> String {
    let needle = query
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());

    let mut matches: Vec<(String, &ShareBook)> = books
        .iter()
        .filter(|book| match needle.as_deref() {
            Some(needle) => matches_query(book, needle),
            None => true,
        })
        .map(|book| (sort_key(book), book))
        .collect();

    matches.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then_with(|| a.1.title.cmp(&b.1.title))
            .then_with(|| a.1.id.cmp(&b.1.id))
    });

    let total = matches.len();
    let page = page.max(1);
    let start = (page - 1).saturating_mul(PAGE_SIZE);
    let entries: &[(String, &ShareBook)] = if start < total {
        &matches[start..(start + PAGE_SIZE).min(total)]
    } else {
        &[]
    };

    let updated = books
        .iter()
        .map(|book| normalized_stamp(&book.updated_at))
        .max()
        .unwrap_or(EPOCH);

    let self_href = page_href(origin, query, page);
    let mut out = String::with_capacity(1024 + entries.len() * 640);

    out.push_str("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n");
    out.push_str(
        "<feed xmlns=\"http://www.w3.org/2005/Atom\" \
         xmlns:dc=\"http://purl.org/dc/terms/\" \
         xmlns:opds=\"http://opds-spec.org/2010/catalog\">\n",
    );
    out.push_str("<id>urn:bookdrop:catalog</id>\n");
    out.push_str("<title>Bookdrop</title>\n");
    let _ = writeln!(out, "<updated>{}</updated>", escape(updated));
    let _ = writeln!(
        out,
        "<link rel=\"self\" href=\"{}\" type=\"{}\"/>",
        escape(&self_href),
        ACQUISITION_TYPE
    );
    let _ = writeln!(
        out,
        "<link rel=\"start\" href=\"{}\" type=\"{}\"/>",
        escape(&format!("{origin}/opds")),
        CATALOG_TYPE
    );
    let _ = writeln!(
        out,
        "<link rel=\"search\" href=\"{}\" type=\"{}\"/>",
        escape(&format!("{origin}{SEARCH_TEMPLATE}")),
        ACQUISITION_TYPE
    );
    if entries.len() == PAGE_SIZE && start + PAGE_SIZE < total {
        let _ = writeln!(
            out,
            "<link rel=\"next\" href=\"{}\" type=\"{}\"/>",
            escape(&page_href(origin, query, page + 1)),
            ACQUISITION_TYPE
        );
    }
    if page > 1 {
        let _ = writeln!(
            out,
            "<link rel=\"prev\" href=\"{}\" type=\"{}\"/>",
            escape(&page_href(origin, query, page - 1)),
            ACQUISITION_TYPE
        );
    }

    for (_, book) in entries {
        out.push_str("<entry>\n");
        let _ = writeln!(out, "<id>urn:bookdrop:book:{}</id>", book.id);
        let _ = writeln!(out, "<title>{}</title>", escape(&book.title));
        let _ = writeln!(
            out,
            "<updated>{}</updated>",
            escape(normalized_stamp(&book.updated_at))
        );
        let _ = writeln!(
            out,
            "<author><name>{}</name></author>",
            escape(&book.authors)
        );
        if let Some(language) = trimmed(&book.language) {
            let _ = writeln!(out, "<dc:language>{}</dc:language>", escape(language));
        }
        if let Some(description) = trimmed(&book.description) {
            let _ = writeln!(
                out,
                "<content type=\"text\">{}</content>",
                escape(description)
            );
        }
        if let Some(cover) = book.cover_path.as_deref()
            && !cover.is_empty()
        {
            let cover_href = format!("{origin}/book/{}/cover", book.id);
            for rel in [
                "http://opds-spec.org/image",
                "http://opds-spec.org/image/thumbnail",
            ] {
                let _ = writeln!(
                    out,
                    "<link rel=\"{rel}\" href=\"{}\" type=\"image/jpeg\"/>",
                    escape(&cover_href)
                );
            }
        }
        let file_href = format!("{origin}/book/{}/file", book.id);
        match book.file_size {
            Some(size) if size > 0 => {
                let _ = writeln!(
                    out,
                    "<link rel=\"http://opds-spec.org/acquisition\" href=\"{}\" \
                     type=\"application/epub+zip\" length=\"{size}\"/>",
                    escape(&file_href)
                );
            }
            _ => {
                let _ = writeln!(
                    out,
                    "<link rel=\"http://opds-spec.org/acquisition\" href=\"{}\" \
                     type=\"application/epub+zip\"/>",
                    escape(&file_href)
                );
            }
        }
        out.push_str("</entry>\n");
    }

    out.push_str("</feed>\n");
    out
}

pub(super) const ACQUISITION_TYPE: &str =
    "application/atom+xml;profile=opds-catalog;kind=acquisition";
const CATALOG_TYPE: &str = "application/atom+xml;profile=opds-catalog";
/// OPDS clients replace this placeholder with the URL-encoded query.
const SEARCH_TEMPLATE: &str = "/opds/search?q={searchTerms}";

fn page_href(origin: &str, query: Option<&str>, page: usize) -> String {
    let mut href = match query {
        Some(q) if !q.trim().is_empty() => {
            format!("{origin}/opds/search?q={}", percent_encode(q))
        }
        _ => format!("{origin}/opds"),
    };
    if page > 1 {
        let separator = if href.contains('?') { '&' } else { '?' };
        let _ = write!(href, "{separator}page={page}");
    }
    href
}

fn sort_key(book: &ShareBook) -> String {
    trimmed(&book.title_sort)
        .unwrap_or(&book.title)
        .to_lowercase()
}

fn matches_query(book: &ShareBook, needle: &str) -> bool {
    let haystacks = [
        Some(book.title.as_str()),
        Some(book.authors.as_str()),
        book.series.as_deref(),
    ];
    haystacks
        .into_iter()
        .flatten()
        .any(|value| value.to_lowercase().contains(needle))
}

fn trimmed(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

/// Atom wants an RFC 3339 timestamp. Rows store `toISOString()` output; an old
/// row with anything else falls back to the epoch rather than breaking clients.
fn normalized_stamp(value: &str) -> &str {
    let value = value.trim();
    if value.len() >= 19 && value.as_bytes().get(10) == Some(&b'T') {
        value
    } else {
        EPOCH
    }
}

fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 8);
    for character in value.chars() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            other if is_xml_char(other) => out.push(other),
            // XML 1.0 cannot carry most C0 controls; dropping them keeps a
            // stray byte in metadata from producing an unparsable feed.
            _ => {}
        }
    }
    out
}

fn is_xml_char(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\r')
        || ('\u{20}'..='\u{D7FF}').contains(&character)
        || ('\u{E000}'..='\u{FFFD}').contains(&character)
        || ('\u{10000}'..='\u{10FFFF}').contains(&character)
}

/// Percent-encode for a query string or a `filename*` value.
pub(super) fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len() * 3);
    for byte in value.as_bytes() {
        let keep = byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~');
        if keep {
            out.push(*byte as char);
        } else {
            let _ = write!(out, "%{byte:02X}");
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn book(id: i64, title: &str) -> ShareBook {
        ShareBook {
            id,
            title: title.to_string(),
            authors: "Frank Herbert".to_string(),
            title_sort: None,
            updated_at: "2026-11-16T10:00:00.000Z".to_string(),
            language: Some("en".to_string()),
            series: None,
            description: None,
            file_path: "C:\\library\\dune.epub".to_string(),
            file_name: "dune.epub".to_string(),
            file_size: Some(1024),
            cover_path: None,
        }
    }

    fn entries(feed: &str) -> usize {
        feed.matches("<entry>").count()
    }

    #[test]
    fn escapes_xml_text_and_attributes() {
        assert_eq!(
            escape("a & b < c > \"d\" 'e'"),
            "a &amp; b &lt; c &gt; &quot;d&quot; &apos;e&apos;"
        );
    }

    #[test]
    fn renders_one_page_and_links() {
        let books: Vec<ShareBook> = (1..=3).map(|id| book(id, &format!("Book {id}"))).collect();
        let feed = render_feed(&books, "http://192.168.1.5:8099", 1, None);
        assert_eq!(entries(&feed), 3);
        assert!(feed.contains("<title>Book 1</title>"));
        assert!(feed.contains("href=\"http://192.168.1.5:8099/book/1/file\""));
        assert!(feed.contains("length=\"1024\""));
        assert!(feed.contains("rel=\"search\""));
        assert!(feed.contains(
            "rel=\"search\" href=\"http://192.168.1.5:8099/opds/search?q={searchTerms}\""
        ));
        assert!(!feed.contains("rel=\"next\""));
    }

    #[test]
    fn paginates_and_clamps_an_oversized_page() {
        let books: Vec<ShareBook> = (1..=51)
            .map(|id| book(id, &format!("Book {id:03}")))
            .collect();

        let first = render_feed(&books, "http://host:8099", 1, None);
        assert_eq!(entries(&first), PAGE_SIZE);
        assert!(first.contains("rel=\"next\""));
        assert!(first.contains("page=2"));
        assert!(!first.contains("rel=\"prev\""));

        let second = render_feed(&books, "http://host:8099", 2, None);
        assert_eq!(entries(&second), 1);
        assert!(second.contains("Book 051"));
        assert!(second.contains("rel=\"prev\""));

        let empty = render_feed(&books, "http://host:8099", 9, None);
        assert_eq!(entries(&empty), 0);
        assert!(!empty.contains("rel=\"next\""));
    }

    #[test]
    fn searches_title_author_and_series() {
        let mut dune = book(1, "Dune");
        let other = book(2, "Emma");
        dune.series = Some("Dune Chronicles".to_string());
        let books = vec![dune, other];

        let by_title = render_feed(&books, "", 1, Some("dun"));
        assert_eq!(entries(&by_title), 1);
        assert!(by_title.contains("<title>Dune</title>"));
        assert!(by_title.contains("/opds/search?q=dun"));
        assert!(by_title.contains("href=\"/opds/search?q={searchTerms}\""));

        let by_author = render_feed(&books, "", 1, Some("herbert"));
        assert_eq!(entries(&by_author), 2);

        let none = render_feed(&books, "", 1, Some("tolkien"));
        assert_eq!(entries(&none), 0);
    }

    #[test]
    fn sorts_by_title_sort_then_title() {
        let mut b = book(1, "The Dune");
        b.title_sort = Some("Dune, The".to_string());
        let a = book(2, "Emma");
        let feed = render_feed(&[b, a], "", 1, None);
        let dune_at = feed.find("<title>The Dune</title>").unwrap();
        let emma_at = feed.find("<title>Emma</title>").unwrap();
        assert!(dune_at < emma_at);
    }

    #[test]
    fn keeps_missing_covers_out_of_the_feed() {
        let feed = render_feed(&[book(1, "Dune")], "", 1, None);
        assert!(!feed.contains("/cover"));
    }

    #[test]
    fn links_cover_images_when_there_is_one() {
        let mut with_cover = book(1, "Dune");
        with_cover.cover_path = Some("C:\\covers\\1.jpg".to_string());
        let feed = render_feed(&[with_cover], "http://host:8099", 1, None);
        assert_eq!(feed.matches("http://opds-spec.org/image").count(), 2);
        assert!(feed.contains("href=\"http://host:8099/book/1/cover\""));
    }

    #[test]
    fn drops_characters_xml_cannot_carry() {
        assert_eq!(escape("a\u{0}b\u{1b}c"), "abc");
        assert_eq!(
            escape("keep\ttabs\nand\rreturns"),
            "keep\ttabs\nand\rreturns"
        );
    }

    #[test]
    fn rejects_implausible_timestamps() {
        assert_eq!(
            normalized_stamp("2026-11-16T10:00:00.000Z"),
            "2026-11-16T10:00:00.000Z"
        );
        assert_eq!(normalized_stamp("2026-11-16 10:00:00"), EPOCH);
        assert_eq!(normalized_stamp(""), EPOCH);
    }

    #[test]
    fn percent_encodes_query_values() {
        assert_eq!(percent_encode("Dune & Emma"), "Dune%20%26%20Emma");
    }
}
