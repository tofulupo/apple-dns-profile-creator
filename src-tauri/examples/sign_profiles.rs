//! Signs the unsigned profiles `deno task profiles` writes, with a certificate
//! from the Keychain, the same way the app's Sign button does. macOS only.
//!
//! sign_profiles <unsigned folder> <signed folder> <certificate name or SHA-1>

use std::fs;
use std::path::Path;
use std::process::ExitCode;

const EXTENSION: &str = "mobileconfig";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [from, to, wanted] = args.as_slice() else {
        eprintln!(
            "usage: sign_profiles <unsigned folder> <signed folder> <certificate name or SHA-1>"
        );
        return ExitCode::FAILURE;
    };
    match run(Path::new(from), Path::new(to), wanted) {
        Ok(count) => {
            println!("Signed {count} profiles into {to}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

fn profiles_in(folder: &Path) -> Result<Vec<String>, String> {
    let entries = fs::read_dir(folder).map_err(|error| format!("{}: {error}", folder.display()))?;
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == EXTENSION))
        .filter_map(|path| path.file_name()?.to_str().map(String::from))
        .collect();
    names.sort();
    Ok(names)
}

fn run(from: &Path, to: &Path, wanted: &str) -> Result<usize, String> {
    let identities = dns_profile_creator_lib::keychain_identities()?;
    if identities.is_empty() {
        return Err(
            "No signing certificate found. This needs macOS and a certificate \
                    with its private key in the Keychain."
                .into(),
        );
    }
    let matching: Vec<&(String, String)> = identities
        .iter()
        .filter(|(id, name)| id.eq_ignore_ascii_case(wanted) || name == wanted)
        .collect();
    let [(id, name)] = matching.as_slice() else {
        let known: Vec<String> = identities
            .iter()
            .map(|(id, name)| format!("  {id}  {name}"))
            .collect();
        return Err(format!(
            "{} certificates match \"{wanted}\". In the Keychain:\n{}",
            matching.len(),
            known.join("\n")
        ));
    };

    let names = profiles_in(from)?;
    if names.is_empty() {
        return Err(format!("No .{EXTENSION} files in {}", from.display()));
    }
    let mut signed = Vec::new();
    for file in &names {
        let xml =
            fs::read_to_string(from.join(file)).map_err(|error| format!("{file}: {error}"))?;
        let bytes = dns_profile_creator_lib::sign_with_keychain(&xml, id)
            .map_err(|error| format!("{file}: {error}"))?;
        signed.push((file, bytes));
    }

    fs::create_dir_all(to).map_err(|error| format!("{}: {error}", to.display()))?;
    for old in profiles_in(to)? {
        if !names.contains(&old) {
            fs::remove_file(to.join(&old)).map_err(|error| format!("{old}: {error}"))?;
        }
    }
    for (file, bytes) in &signed {
        fs::write(to.join(file), bytes).map_err(|error| format!("{file}: {error}"))?;
    }
    println!("Signed with {name}");
    Ok(signed.len())
}
