#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wintrust.h>
#include <softpub.h>
#include <stdio.h>
#include <wbemidl.h>
#include <string>
#include <vector>

template<class T> struct ComObject {
    T* value = nullptr;
    ~ComObject() { if (value) value->Release(); }
};
struct BString {
    BSTR value;
    explicit BString(const wchar_t* text) : value(SysAllocString(text)) {}
    ~BString() { SysFreeString(value); }
};
struct ComLifetime { ~ComLifetime() { CoUninitialize(); } };

static std::wstring jsonString(const std::wstring& text) {
    std::wstring result = L"\"";
    for (wchar_t character : text) {
        if (character == L'"' || character == L'\\') result += L'\\';
        if (character < 32) {
            wchar_t escaped[7] = {};
            swprintf_s(escaped, L"\\u%04x", static_cast<unsigned int>(character));
            result += escaped;
        } else result += character;
    }
    return result + L"\"";
}

// WMI supplies both executable and launch command. An Electron executable
// outside the install can still load that install's app.asar, so both matter.
// This read-only mode does not depend on a user's PowerShell runtime/modules.
static int processIdentity(const wchar_t* argument) {
    wchar_t* end = nullptr;
    const unsigned long pid = wcstoul(argument, &end, 10);
    if (!pid || !end || *end || pid == MAXDWORD) return 10;
    if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return 11;
    ComLifetime com;
    const HRESULT security = CoInitializeSecurity(nullptr, -1, nullptr, nullptr,
        RPC_C_AUTHN_LEVEL_DEFAULT, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE, nullptr);
    if (FAILED(security) && security != RPC_E_TOO_LATE) return 12;
    ComObject<IWbemLocator> locator;
    if (FAILED(CoCreateInstance(CLSID_WbemLocator, nullptr, CLSCTX_INPROC_SERVER,
        IID_IWbemLocator, reinterpret_cast<void**>(&locator.value)))) return 13;
    ComObject<IWbemServices> services;
    BString space(L"ROOT\\CIMV2");
    if (FAILED(locator.value->ConnectServer(space.value, nullptr, nullptr, nullptr,
        0, nullptr, nullptr, &services.value))) return 14;
    if (FAILED(CoSetProxyBlanket(services.value, RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE,
        nullptr, RPC_C_AUTHN_LEVEL_CALL, RPC_C_IMP_LEVEL_IMPERSONATE, nullptr, EOAC_NONE))) return 15;
    const std::wstring query = L"SELECT ExecutablePath,CommandLine,CreationDate FROM Win32_Process WHERE ProcessId="
        + std::to_wstring(pid);
    BString language(L"WQL"), statement(query.c_str());
    ComObject<IEnumWbemClassObject> rows;
    if (FAILED(services.value->ExecQuery(language.value, statement.value,
        WBEM_FLAG_FORWARD_ONLY | WBEM_FLAG_RETURN_IMMEDIATELY, nullptr, &rows.value))) return 16;
    ComObject<IWbemClassObject> row;
    ULONG count = 0;
    if (FAILED(rows.value->Next(5000, 1, &row.value, &count)) || count != 1) return 17;
    const wchar_t* properties[] = { L"ExecutablePath", L"CommandLine", L"CreationDate" };
    std::wstring values[3];
    for (size_t index = 0; index < 3; ++index) {
        VARIANT value;
        VariantInit(&value);
        const HRESULT status = row.value->Get(properties[index], 0, &value, nullptr, nullptr);
        const bool valid = SUCCEEDED(status) && value.vt == VT_BSTR && value.bstrVal && *value.bstrVal;
        if (valid) values[index] = value.bstrVal;
        VariantClear(&value);
        if (!valid) return 18;
    }
    const std::wstring output = L"{\"ProcessId\":" + std::to_wstring(pid)
        + L",\"ExecutablePath\":" + jsonString(values[0])
        + L",\"CommandLine\":" + jsonString(values[1])
        + L",\"Started\":" + jsonString(values[2]) + L"}\n";
    const int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, output.c_str(),
        static_cast<int>(output.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) return 19;
    std::vector<char> bytes(static_cast<size_t>(size));
    if (WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, output.c_str(),
        static_cast<int>(output.size()), bytes.data(), size, nullptr, nullptr) != size) return 19;
    return fwrite(bytes.data(), 1, bytes.size(), stdout) == bytes.size() ? 0 : 20;
}

// Only a well-formed PE with an empty certificate table can be unsigned.
// A damaged embedded signature must never enter the unsigned release policy.
static bool unsignedPe(HANDLE file) {
    IMAGE_DOS_HEADER dos = {};
    DWORD read = 0;
    LARGE_INTEGER offset = {};
    if (!SetFilePointerEx(file, offset, nullptr, FILE_BEGIN) ||
        !ReadFile(file, &dos, sizeof(dos), &read, nullptr) || read != sizeof(dos) ||
        dos.e_magic != IMAGE_DOS_SIGNATURE || dos.e_lfanew < sizeof(dos)) return false;
    offset.QuadPart = dos.e_lfanew;
    struct Header { DWORD signature; IMAGE_FILE_HEADER file; } header = {};
    if (!SetFilePointerEx(file, offset, nullptr, FILE_BEGIN) ||
        !ReadFile(file, &header, sizeof(header), &read, nullptr) || read != sizeof(header) ||
        header.signature != IMAGE_NT_SIGNATURE) return false;
    BYTE optional[sizeof(IMAGE_OPTIONAL_HEADER64)] = {};
    if (header.file.SizeOfOptionalHeader > sizeof(optional) ||
        !ReadFile(file, optional, header.file.SizeOfOptionalHeader, &read, nullptr) ||
        read != header.file.SizeOfOptionalHeader) return false;
    IMAGE_DATA_DIRECTORY certificate = {};
    if (*reinterpret_cast<WORD*>(optional) == IMAGE_NT_OPTIONAL_HDR64_MAGIC &&
        read == sizeof(IMAGE_OPTIONAL_HEADER64)) {
        const auto* pe = reinterpret_cast<IMAGE_OPTIONAL_HEADER64*>(optional);
        if (pe->NumberOfRvaAndSizes <= IMAGE_DIRECTORY_ENTRY_SECURITY) return false;
        certificate = pe->DataDirectory[IMAGE_DIRECTORY_ENTRY_SECURITY];
    } else if (*reinterpret_cast<WORD*>(optional) == IMAGE_NT_OPTIONAL_HDR32_MAGIC &&
        read == sizeof(IMAGE_OPTIONAL_HEADER32)) {
        const auto* pe = reinterpret_cast<IMAGE_OPTIONAL_HEADER32*>(optional);
        if (pe->NumberOfRvaAndSizes <= IMAGE_DIRECTORY_ENTRY_SECURITY) return false;
        certificate = pe->DataDirectory[IMAGE_DIRECTORY_ENTRY_SECURITY];
    } else return false;
    return certificate.VirtualAddress == 0 && certificate.Size == 0;
}

int wmain(int argc, wchar_t** argv) {
    if (argc == 3 && wcscmp(argv[1], L"--process-info") == 0) return processIdentity(argv[2]);
    if (argc != 2) return 2;
    // Lock the verified bytes against modification while WinTrust reads them.
    HANDLE file = CreateFileW(argv[1], GENERIC_READ, FILE_SHARE_READ, nullptr,
        OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return 3;
    WINTRUST_FILE_INFO info = {};
    info.cbStruct = sizeof(info);
    info.pcwszFilePath = argv[1];
    info.hFile = file;
    WINTRUST_DATA trust = {};
    trust.cbStruct = sizeof(trust);
    trust.dwUIChoice = WTD_UI_NONE;
    trust.dwUnionChoice = WTD_CHOICE_FILE;
    trust.pFile = &info;
    trust.dwStateAction = WTD_STATEACTION_VERIFY;
    trust.dwProvFlags = WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT;
    GUID policy = WINTRUST_ACTION_GENERIC_VERIFY_V2;
    const LONG status = WinVerifyTrust(reinterpret_cast<HWND>(INVALID_HANDLE_VALUE), &policy, &trust);
    trust.dwStateAction = WTD_STATEACTION_CLOSE;
    const LONG closed = WinVerifyTrust(reinterpret_cast<HWND>(INVALID_HANDLE_VALUE), &policy, &trust);
    const bool noSignature = status == TRUST_E_NOSIGNATURE && unsignedPe(file);
    CloseHandle(file);
    if (closed != ERROR_SUCCESS) return 4;
    if (status == ERROR_SUCCESS) puts("Valid");
    else if (noSignature) puts("NotSigned");
    else if (status == TRUST_E_BAD_DIGEST) puts("HashMismatch");
    else puts("NotTrusted");
    return 0;
}
