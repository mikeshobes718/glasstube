import SwiftUI

struct PairView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var typed = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                if store.paired {
                    Section {
                        HStack {
                            Label("Paired", systemImage: "checkmark.seal.fill")
                                .foregroundStyle(.green)
                            Spacer()
                            if !store.code.isEmpty {
                                Text(store.code)
                                    .font(.system(.body, design: .monospaced).weight(.semibold))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    } footer: {
                        Text("This phone stays linked on its own. You only type a code again if you pair the glasses to a different phone.")
                    }

                    Section {
                        Button("Unpair this phone", role: .destructive) {
                            store.unpair(note: "Unpaired.")
                        }
                    }
                } else {
                    Section {
                        TextField("ABC123", text: $typed)
                            .font(.system(.largeTitle, design: .monospaced).weight(.bold))
                            .multilineTextAlignment(.center)
                            .textInputAutocapitalization(.characters)
                            .autocorrectionDisabled()
                            .focused($focused)
                            .onChange(of: typed) { _, new in
                                let clean = new.uppercased().filter { $0.isLetter || $0.isNumber }
                                typed = String(clean.prefix(6))
                                if typed.count == 6 { submit() }
                            }
                    } header: {
                        Text("Code from the glasses")
                    } footer: {
                        Text("On the glasses open GlassTube, choose From iPhone, and read the six characters.")
                    }

                    Section {
                        Button(action: submit) {
                            if store.pairBusy {
                                ProgressView().frame(maxWidth: .infinity)
                            } else {
                                Text("Connect").frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(typed.count != 6 || store.pairBusy)
                    }
                }

                if !store.pairNote.isEmpty {
                    Section { Text(store.pairNote).font(.footnote) }
                }
            }
            .navigationTitle("Glasses")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear { focused = !store.paired }
            .onChange(of: store.paired) { _, now in
                if now { dismiss() }
            }
        }
    }

    private func submit() {
        focused = false
        Task { await store.connect(typed) }
    }
}
